/**
 * favorites.rs — "收藏" 虚拟文件夹服务 (独立于真实文件系统).
 *
 * 职责:
 *   - 维护一组被收藏的 Markdown 文件 + 多级虚拟目录树.
 *   - 持久化到独立 JSON 文件 `<app_data_dir>/favorites.json`, schema { version, folders, files }.
 *   - 扁平节点结构 (parentId 引用) 便于 rename / move / 去重校验; 不用深层嵌套 JSON.
 *   - 收藏项仅存路径引用 — 任何操作都不创建/不删除磁盘真实文件
 *     (删除收藏目录只移除引用, 与 recent_dirs 同理).
 *   - 不引入新 crate 依赖: ID 用 FNV-1a 64-bit 哈希 + 前缀; 时间戳 std::time 手动格式化.
 *
 * 约定:
 *   - add_favorite 幂等: 同一规范化路径已存在收藏时, 原样返回当前快照 (不重复、不移动).
 *     文件 ID 由规范化路径确定性派生 → 天然去重.
 *   - 目录 ID = f(folderId | name | createdNs), 实践中零碰撞 (同进程 Mutex 串行 + ns 时间戳).
 *   - 所有变更: 加锁 → 在快照副本上校验并修改 → 原子写盘成功 → 才提交内存状态.
 *     写盘失败时内存保持原样, 保证内存与磁盘一致.
 *   - load 发现 version > 当前支持 → degraded 模式: 读返回空、变更全部拒绝、保留原文件
 *     (旧版本不得用空数据覆盖未来版本的数据).
 */
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;

use crate::error::AppError;

/// 收藏数据 schema 版本 (升级时 +1, 并在 sanitize/load 中处理向后兼容).
pub const FAVORITES_SCHEMA_VERSION: u32 = 1;

/// 收藏总节点数上限 (folders + files), 防御损坏/恶意 JSON.
pub const MAX_FAVORITE_NODES: usize = 5000;

/// 虚拟目录最大嵌套深度.
pub const MAX_FOLDER_DEPTH: u32 = 16;

/// 目录名最大长度 (Unicode 字符数).
pub const MAX_FOLDER_NAME_LEN: usize = 100;

const STORE_FILE: &str = "favorites.json";

/// favorites.json 允许的最大字节数 — 超过视为损坏, 保留原文件并进入 degraded.
const MAX_STORE_BYTES: u64 = 1_048_576; // 1 MB

// ─────────────────────────────────────────────────────────────────
// 数据模型 (serde camelCase, 与 TS 端 FavoriteFolder/FavoriteFile 1:1 对齐)
// ─────────────────────────────────────────────────────────────────

/// 虚拟目录节点. `parent_id=None` 表示收藏根层级.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteFolder {
    pub id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub name: String,
    pub created_at: String,
}

/// 被收藏的 Markdown 文件 (仅路径引用).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteFile {
    pub id: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    /// 规范化后的绝对路径 (Rust canonicalize).
    pub path: String,
    /// 展示名 (basename), 由 Rust 从真实路径派生, 不信任前端.
    pub display_name: String,
    pub added_at: String,
}

/// 一次 IPC 往返返回的完整快照 — 前端直接整包替换本地状态, 无增量合并.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FavoritesSnapshot {
    pub version: u32,
    pub folders: Vec<FavoriteFolder>,
    pub files: Vec<FavoriteFile>,
}

impl Default for FavoritesSnapshot {
    fn default() -> Self {
        Self {
            version: FAVORITES_SCHEMA_VERSION,
            folders: Vec::new(),
            files: Vec::new(),
        }
    }
}

/// 磁盘 JSON 的宽松解析形状 (缺字段给默认值, 便于手工编辑/旧文件).
#[derive(Debug, Default, Deserialize)]
struct FavoritesStorePayload {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    folders: Vec<FavoriteFolder>,
    #[serde(default)]
    files: Vec<FavoriteFile>,
}

/// 内存状态. `degraded=true` 时只读: get 返回空快照, 变更拒绝 (见模块头约定).
pub struct FavoritesInner {
    pub snapshot: FavoritesSnapshot,
    pub degraded: bool,
}

pub struct FavoritesState {
    pub inner: Mutex<FavoritesInner>,
}

impl FavoritesState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(FavoritesInner {
                snapshot: FavoritesSnapshot::default(),
                degraded: false,
            }),
        }
    }
}

impl Default for FavoritesState {
    fn default() -> Self {
        Self::new()
    }
}

// ─────────────────────────────────────────────────────────────────
// 基础工具 (无新依赖)
// ─────────────────────────────────────────────────────────────────

/// FNV-1a 64-bit — ID 派生用, 确定性 + 实践零碰撞.
fn fnv1a_64(input: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in input {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// 当前 Unix 纳秒 (ID 熵源之一).
fn now_ns() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

/// 收藏文件 ID — 由规范化路径确定性派生 (幂等添加的关键).
pub fn file_id_for(canonical_path: &str) -> String {
    format!("f_{:016x}", fnv1a_64(canonical_path.as_bytes()))
}

/// 路径比较 — 在大小写不敏感文件系统上 (Windows NTFS / macOS APFS 默认配置 /
/// FAT32 / exFAT 等) 把视为同一文件的两种写法识别为同一个收藏.
///
/// 使用 ascii 兜底大小写比较 (而非 Unicode-aware `to_lowercase`):
///   - 收藏 ID / file id 都是 hash 出来的字符串, 不是用户展示文本;
///   - 复杂 Unicode 大小写 (Turkish dotless i / 德文 ß → SS 等) 在路径中实际场景罕见;
///   - 与前端 TS `pathEq` 保持完全一致, 避免后端去重后前端又生成重复项.
pub fn path_eq(a: &str, b: &str) -> bool {
    a == b || a.eq_ignore_ascii_case(b)
}

/// 目录 ID — parent|name|ns|seq 四元组哈希.
/// seq (进程内单调递增) 保证时钟同纳秒连发也必不同; ns 区分跨进程重启的相同操作序列.
static FOLDER_ID_SEQ: AtomicU64 = AtomicU64::new(0);

fn folder_id(parent_id: Option<&str>, name: &str) -> String {
    let seq = FOLDER_ID_SEQ.fetch_add(1, Ordering::Relaxed);
    let input = format!("{}|{}|{}|{}", parent_id.unwrap_or(""), name, now_ns(), seq);
    format!("d_{:016x}", fnv1a_64(input.as_bytes()))
}

fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// epoch 秒 → (y, mo, d, h, mi, s), UTC. 与 recent_dirs.rs 同源算法.
fn epoch_to_ymdhms(mut secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let second = (secs % 60) as u32;
    secs /= 60;
    let minute = (secs % 60) as u32;
    secs /= 60;
    let hour = (secs % 24) as u32;
    let mut days = (secs / 24) as i64;
    let mut year: i32 = 1970;
    loop {
        let yd = if is_leap(year) { 366 } else { 365 };
        if days >= yd {
            days -= yd;
            year += 1;
        } else {
            break;
        }
    }
    let mdays = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month: u32 = 1;
    for &dm in &mdays {
        if days >= dm {
            days -= dm;
            month += 1;
        } else {
            break;
        }
    }
    (year, month, (days + 1) as u32, hour, minute, second)
}

/// ISO8601/RFC3339 时间戳 (秒级, UTC).
fn now_iso8601() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (year, month, day, hour, minute, second) = epoch_to_ymdhms(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, minute, second
    )
}

/// 取 basename (兼容 POSIX '/' 与 Windows '\').
fn derive_display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.to_string())
}

// ─────────────────────────────────────────────────────────────────
// 校验辅助
// ─────────────────────────────────────────────────────────────────

const MARKDOWN_EXTS: &[&str] = &["md", "markdown", "mdx"];

fn is_markdown_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| MARKDOWN_EXTS.contains(&e.to_ascii_lowercase().as_str()))
}

/// 校验"可收藏路径": 非空 / 无 NUL / 是存在的普通 Markdown 文件 → 返回规范化绝对路径.
fn validate_markdown_path(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err(AppError::InvalidPath(
            "favorite path must not be empty".into(),
        ));
    }
    let p = Path::new(trimmed);
    match fs::metadata(p) {
        Ok(m) => {
            if !m.is_file() {
                return Err(AppError::InvalidPath(
                    "favorite target must be a regular file".into(),
                ));
            }
            if !is_markdown_ext(p) {
                return Err(AppError::InvalidPath(
                    "only Markdown files can be favorited (.md / .markdown / .mdx)".into(),
                ));
            }
        }
        Err(e) => {
            return Err(if e.kind() == std::io::ErrorKind::NotFound {
                AppError::NotFound(trimmed.to_string())
            } else {
                AppError::Io(e)
            });
        }
    }
    let canonical = p
        .canonicalize()
        .map_err(|e| AppError::InvalidPath(format!("cannot resolve path: {e}")))?;
    Ok(canonical.to_string_lossy().into_owned())
}

/// 目录名校验 → 返回 trim 后的合法名称.
fn validate_folder_name(raw: &str) -> Result<String, AppError> {
    let name = raw.trim();
    if name.is_empty() || name.contains('\0') {
        return Err(AppError::InvalidPath(
            "folder name must not be empty".into(),
        ));
    }
    if name.chars().any(|c| c == '/' || c == '\\') {
        return Err(AppError::InvalidPath(
            "folder name must not contain path separators".into(),
        ));
    }
    if name.chars().count() > MAX_FOLDER_NAME_LEN {
        return Err(AppError::InvalidPath(format!(
            "folder name too long (max {MAX_FOLDER_NAME_LEN} chars)"
        )));
    }
    Ok(name.to_string())
}

/// 校验 parent_id: None=根, Some 必须指向已存在目录.
fn validate_parent(snapshot: &FavoritesSnapshot, parent_id: Option<&str>) -> Result<(), AppError> {
    match parent_id {
        None => Ok(()),
        Some(id) => {
            if snapshot.folders.iter().any(|f| f.id == id) {
                Ok(())
            } else {
                Err(AppError::NotFound(format!(
                    "favorite folder not found: {id}"
                )))
            }
        }
    }
}

/// 某目录的嵌套深度 (自身所在层, 根=1). parent 链断裂/成环时安全截断.
fn folder_depth(snapshot: &FavoritesSnapshot, folder_id: &str) -> u32 {
    let mut depth = 0u32;
    let mut cur = Some(folder_id.to_string());
    while let Some(id) = cur {
        depth += 1;
        if depth > MAX_FOLDER_DEPTH + 2 {
            break; // 防御环
        }
        cur = snapshot
            .folders
            .iter()
            .find(|f| f.id == id)
            .and_then(|f| f.parent_id.clone());
    }
    depth
}

/// 从某目录出发的完整子树 folder id 集合 (含自身). 环安全.
fn subtree_folder_ids(snapshot: &FavoritesSnapshot, root_id: &str) -> HashSet<String> {
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for f in &snapshot.folders {
        if let Some(p) = &f.parent_id {
            children.entry(p.as_str()).or_default().push(&f.id);
        }
    }
    let mut out = HashSet::new();
    let mut stack = vec![root_id];
    while let Some(id) = stack.pop() {
        if !out.insert(id.to_string()) {
            continue; // 已访问 (防御环)
        }
        if let Some(kids) = children.get(id) {
            for k in kids.iter() {
                stack.push(*k);
            }
        }
    }
    out
}

// ─────────────────────────────────────────────────────────────────
// 核心变更逻辑 (操作 FavoritesSnapshot 副本, 无 IO/无锁 → 可单测)
// ─────────────────────────────────────────────────────────────────

/// 添加收藏. 已存在同路径收藏时幂等返回 (不重复、不移动).
fn apply_add_favorite(
    snapshot: &mut FavoritesSnapshot,
    raw_path: &str,
    parent_id: Option<&str>,
) -> Result<(), AppError> {
    let canonical = validate_markdown_path(raw_path)?;
    if snapshot
        .files
        .iter()
        .any(|f| path_eq(f.path.as_str(), canonical.as_str()))
    {
        return Ok(()); // 幂等: 已有收藏引用 → no-op
    }
    validate_parent(snapshot, parent_id)?;
    let node = FavoriteFile {
        id: file_id_for(&canonical),
        parent_id: parent_id.map(|s| s.to_string()),
        path: canonical,
        display_name: derive_display_name(raw_path),
        added_at: now_iso8601(),
    };
    snapshot.files.push(node);
    Ok(())
}

/// 取消收藏 (按文件节点 ID). 不存在时 no-op.
fn apply_remove_favorite(snapshot: &mut FavoritesSnapshot, file_id: &str) {
    snapshot.files.retain(|f| f.id != file_id);
}

/// 新建虚拟目录.
fn apply_create_folder(
    snapshot: &mut FavoritesSnapshot,
    parent_id: Option<&str>,
    raw_name: &str,
) -> Result<(), AppError> {
    let name = validate_folder_name(raw_name)?;
    validate_parent(snapshot, parent_id)?;
    if let Some(pid) = parent_id {
        let depth = folder_depth(snapshot, pid).saturating_add(1);
        if depth > MAX_FOLDER_DEPTH {
            return Err(AppError::InvalidPath(format!(
                "folder nesting too deep (max {MAX_FOLDER_DEPTH} levels)"
            )));
        }
    }
    // 同一父目录下名称不可重复 (大小写不敏感, 贴近文件系统习惯).
    let dup = snapshot
        .folders
        .iter()
        .any(|f| f.parent_id.as_deref() == parent_id && f.name.eq_ignore_ascii_case(&name));
    if dup {
        return Err(AppError::InvalidPath(format!(
            "a folder named \"{name}\" already exists in this level"
        )));
    }
    let node = FavoriteFolder {
        id: folder_id(parent_id, &name),
        parent_id: parent_id.map(|s| s.to_string()),
        name,
        created_at: now_iso8601(),
    };
    snapshot.folders.push(node);
    Ok(())
}

/// 重命名目录.
fn apply_rename_folder(
    snapshot: &mut FavoritesSnapshot,
    folder_id: &str,
    raw_name: &str,
) -> Result<(), AppError> {
    let name = validate_folder_name(raw_name)?;
    let idx = snapshot
        .folders
        .iter()
        .position(|f| f.id == folder_id)
        .ok_or_else(|| AppError::NotFound(format!("favorite folder not found: {folder_id}")))?;
    if snapshot.folders[idx].name != name {
        let pid = snapshot.folders[idx].parent_id.clone();
        let dup = snapshot.folders.iter().any(|f| {
            f.id != folder_id
                && f.parent_id.as_deref() == pid.as_deref()
                && f.name.eq_ignore_ascii_case(&name)
        });
        if dup {
            return Err(AppError::InvalidPath(format!(
                "a folder named \"{name}\" already exists in this level"
            )));
        }
    }
    snapshot.folders[idx].name = name;
    Ok(())
}

/// 移动目录或文件到目标父级 (None=根). 禁止移入自身/自身后代 (环).
fn apply_move_node(
    snapshot: &mut FavoritesSnapshot,
    node_id: &str,
    target_parent_id: Option<&str>,
) -> Result<(), AppError> {
    validate_parent(snapshot, target_parent_id)?;
    // 目录节点: 先校验 (自身/后代 → 拒绝), 再改 parent_id.
    if let Some(idx) = snapshot.folders.iter().position(|f| f.id == node_id) {
        if let Some(t) = target_parent_id {
            if t == node_id {
                return Err(AppError::InvalidPath(
                    "cannot move a folder into itself".into(),
                ));
            }
            // 目标是否为该目录的后代? (在可变借出前完成查询).
            let subtree = subtree_folder_ids(snapshot, node_id);
            if subtree.contains(t) {
                return Err(AppError::InvalidPath(
                    "cannot move a folder into its own descendant".into(),
                ));
            }
        }
        snapshot.folders[idx].parent_id = target_parent_id.map(|s| s.to_string());
        return Ok(());
    }
    // 文件节点.
    if let Some(idx) = snapshot.files.iter().position(|f| f.id == node_id) {
        snapshot.files[idx].parent_id = target_parent_id.map(|s| s.to_string());
        return Ok(());
    }
    Err(AppError::NotFound(format!(
        "favorite node not found: {node_id}"
    )))
}

/// 删除目录 (含子树). `recursive=false` 时仅允许空目录.
/// 只移除收藏元数据 — 永不触碰磁盘文件.
fn apply_delete_folder(
    snapshot: &mut FavoritesSnapshot,
    folder_id: &str,
    recursive: bool,
) -> Result<(), AppError> {
    if !snapshot.folders.iter().any(|f| f.id == folder_id) {
        return Err(AppError::NotFound(format!(
            "favorite folder not found: {folder_id}"
        )));
    }
    let subtree = subtree_folder_ids(snapshot, folder_id);
    // 子树内的文件数 (直接父级在子树内).
    let files_in_subtree = snapshot
        .files
        .iter()
        .filter(|f| f.parent_id.as_deref().is_some_and(|p| subtree.contains(p)))
        .count();
    let child_folders = subtree.len() - 1; // 不含自身
    if !recursive && (child_folders > 0 || files_in_subtree > 0) {
        return Err(AppError::InvalidPath(
            "folder is not empty; pass recursive=true to remove the whole subtree".into(),
        ));
    }
    snapshot.folders.retain(|f| !subtree.contains(&f.id));
    snapshot
        .files
        .retain(|f| !f.parent_id.as_deref().is_some_and(|p| subtree.contains(p)));
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// 持久化 (atomic write) + 状态加载 (sanitize)
// ─────────────────────────────────────────────────────────────────

/// tmp 文件唯一性序号 — 避免同机多实例/并发写冲突.
static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn store_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Unknown(format!("app_data_dir resolve failed: {e}")))?;
    Ok(dir.join(STORE_FILE))
}

/// 原子写盘: tmp 文件 → fsync → rename.
fn persist_to_store(app: &AppHandle, snapshot: &FavoritesSnapshot) -> Result<(), AppError> {
    let path = store_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let body = serde_json::to_string_pretty(snapshot)
        .map_err(|e| AppError::Unknown(format!("serialize failed: {e}")))?;
    let n = TMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_file_name(format!("favorites.json.tmp.{n}"));
    {
        let file = fs::File::create(&tmp).map_err(AppError::Io)?;
        let mut w = std::io::BufWriter::new(file);
        w.write_all(body.as_bytes()).map_err(AppError::Io)?;
        w.flush().map_err(AppError::Io)?;
    }
    // 先落盘再 rename (rename 后 tmp 即生效文件, 不能只靠进程内存).
    fs::rename(&tmp, &path).map_err(AppError::Io)?;
    Ok(())
}

/// 在"悬空父节点"上迭代清理, 直到稳定.
fn drop_dangling_folders(snapshot: &mut FavoritesSnapshot) {
    loop {
        let ids: HashSet<String> = snapshot.folders.iter().map(|f| f.id.clone()).collect();
        let before = snapshot.folders.len();
        snapshot.folders.retain(|f| match f.parent_id.as_deref() {
            None => true,
            Some(p) => ids.contains(p),
        });
        if snapshot.folders.len() == before {
            break;
        }
    }
}

/// 环清理: 任何"向上走 parent 链超过节点数步"的目录必然挂在环上, 连同本次行走链全部丢弃.
fn drop_cyclic_folders(snapshot: &mut FavoritesSnapshot) {
    if snapshot.folders.is_empty() {
        return;
    }
    let limit = snapshot.folders.len();
    let mut bad: HashSet<String> = HashSet::new();
    for start in snapshot.folders.iter().map(|f| f.id.clone()) {
        let mut chain: Vec<String> = Vec::new();
        let mut cur: Option<String> = Some(start);
        let mut steps = 0usize;
        while let Some(id) = cur {
            if steps > limit || chain.contains(&id) {
                // 成环 (或链路过长): 本条链上所有节点全部视为非法.
                for id2 in chain.iter().cloned() {
                    bad.insert(id2);
                }
                bad.insert(id);
                break;
            }
            chain.push(id.clone());
            steps += 1;
            cur = snapshot
                .folders
                .iter()
                .find(|f| f.id == id)
                .and_then(|f| f.parent_id.clone());
        }
    }
    if bad.is_empty() {
        return;
    }
    snapshot.folders.retain(|f| !bad.contains(&f.id));
}

/// 加载期数据清洗 — 防御损坏/手工编辑过的 favorites.json.
///   1. 字段合法性 + folder id 去重
///   2. 悬空父节点迭代清理
///   3. 环清理
///   4. 文件: 合法父级 + 同路径去重 (保留最先出现)
///   5. 总量截断 MAX_FAVORITE_NODES
fn sanitize(payload: &FavoritesStorePayload) -> FavoritesSnapshot {
    let mut out = FavoritesSnapshot::default();

    // 1. folders 基础清洗 + id 去重.
    let mut seen_folder_ids: HashSet<&str> = HashSet::new();
    for f in payload.folders.iter() {
        if f.id.trim().is_empty() || !seen_folder_ids.insert(f.id.as_str()) {
            continue;
        }
        let name = f.name.trim();
        if name.is_empty() {
            continue;
        }
        out.folders.push(FavoriteFolder {
            id: f.id.clone(),
            parent_id: f.parent_id.clone().filter(|p| !p.trim().is_empty()),
            name: name.to_string(),
            created_at: f.created_at.clone(),
        });
    }

    // 2/3. 悬空 + 环.
    drop_dangling_folders(&mut out);
    drop_cyclic_folders(&mut out);
    drop_dangling_folders(&mut out);

    // 4. files 基础清洗: id/path 非空, parent 合法 (None 或已存在), 同 path 去重.
    let folder_ids: HashSet<&str> = out.folders.iter().map(|f| f.id.as_str()).collect();
    let mut seen_paths: HashSet<String> = HashSet::new();
    for file in payload.files.iter() {
        if file.id.trim().is_empty() || file.path.trim().is_empty() {
            continue;
        }
        match file.parent_id.as_deref() {
            Some(p) if !folder_ids.contains(p) => continue, // 父目录已被清掉 → 引用悬空
            _ => {}
        }
        if !seen_paths.insert(file.path.clone()) {
            continue; // 同路径保留第一条
        }
        out.files.push(FavoriteFile {
            id: file.id.clone(),
            parent_id: file.parent_id.clone(),
            path: file.path.clone(),
            display_name: if file.display_name.trim().is_empty() {
                derive_display_name(&file.path)
            } else {
                file.display_name.clone()
            },
            added_at: file.added_at.clone(),
        });
    }

    // 5. 总量截断 (先保 files? 目录结构更重要 — 超限时优先保留目录).
    let total = out.folders.len() + out.files.len();
    if total > MAX_FAVORITE_NODES {
        let excess = total - MAX_FAVORITE_NODES;
        out.files.truncate(out.files.len().saturating_sub(excess));
    }
    out
}

/// 标记 degraded (保留原文件, 拒绝后续变更).
fn mark_degraded(app: &AppHandle) {
    let state = app.state::<FavoritesState>();
    let result = state.inner.lock(); // 显式绑定: MutexGuard 先于 state 析构.
    if let Ok(mut guard) = result {
        guard.degraded = true;
    }
}

/// setup 钩子调用: 加载持久化数据.
///
/// 错误约定 (NFR-S-01 不抛错给用户):
///   - 文件不存在 → state 留空, Ok (首次启动).
///   - 过大/解析失败/version 过新 → degraded 模式 + 保留原文件, Ok.
pub fn load_from_store(app: &AppHandle) -> Result<(), AppError> {
    let path = store_path(app)?;
    match fs::metadata(&path) {
        Ok(m) if m.len() > MAX_STORE_BYTES => {
            eprintln!(
                "[favorites] favorites.json too large ({} bytes > {}), keeping file, entering read-only degraded mode",
                m.len(),
                MAX_STORE_BYTES
            );
            mark_degraded(app);
            return Ok(());
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()), // 首次启动
        _ => {}
    }
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[favorites] read failed: {e}; keeping file, degraded mode");
            mark_degraded(app);
            return Ok(());
        }
    };
    let payload: FavoritesStorePayload = match serde_json::from_str(&raw) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[favorites] parse failed: {e}; keeping file, degraded mode");
            mark_degraded(app);
            return Ok(());
        }
    };
    if payload.version > FAVORITES_SCHEMA_VERSION {
        eprintln!(
            "[favorites] unsupported schema version {} (max supported {}), keeping file, degraded mode",
            payload.version, FAVORITES_SCHEMA_VERSION
        );
        mark_degraded(app);
        return Ok(());
    }
    let snap = sanitize(&payload);
    let binding = app.state::<FavoritesState>();
    if let Ok(mut guard) = binding.inner.lock() {
        guard.snapshot = snap;
        guard.degraded = false;
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────
// 公共 API (供 commands.rs 调用): 变更 → 原子写盘成功 → 提交内存 → 返回整包快照
// ─────────────────────────────────────────────────────────────────

/// 通用变更流程 — 见模块头约定.
fn mutate(
    state: &FavoritesState,
    app: &AppHandle,
    apply: impl FnOnce(&mut FavoritesSnapshot) -> Result<(), AppError>,
) -> Result<FavoritesSnapshot, AppError> {
    let mut guard = state.inner.lock().unwrap_or_else(|p| p.into_inner());
    if guard.degraded {
        return Err(AppError::Unknown(
            "favorites data version not supported by this build; original file preserved".into(),
        ));
    }
    let mut next = guard.snapshot.clone();
    apply(&mut next)?; // 校验失败 → 内存不动
    persist_to_store(app, &next)?; // IO 失败 → 内存不动
    guard.snapshot = next.clone(); // 仅写盘成功后提交
    Ok(next)
}

pub fn get_favorites(state: &FavoritesState) -> FavoritesSnapshot {
    let guard = state.inner.lock().unwrap_or_else(|p| p.into_inner());
    if guard.degraded {
        return FavoritesSnapshot::default();
    }
    guard.snapshot.clone()
}

pub fn add_favorite(
    state: &FavoritesState,
    app: &AppHandle,
    path: String,
    parent_id: Option<String>,
) -> Result<FavoritesSnapshot, AppError> {
    mutate(state, app, |snap| {
        apply_add_favorite(snap, &path, parent_id.as_deref())
    })
}

pub fn remove_favorite(
    state: &FavoritesState,
    app: &AppHandle,
    file_id: String,
) -> Result<FavoritesSnapshot, AppError> {
    mutate(state, app, |snap| {
        apply_remove_favorite(snap, &file_id);
        Ok(())
    })
}

pub fn create_favorite_folder(
    state: &FavoritesState,
    app: &AppHandle,
    parent_id: Option<String>,
    name: String,
) -> Result<FavoritesSnapshot, AppError> {
    mutate(state, app, |snap| {
        apply_create_folder(snap, parent_id.as_deref(), &name)
    })
}

pub fn rename_favorite_folder(
    state: &FavoritesState,
    app: &AppHandle,
    folder_id: String,
    name: String,
) -> Result<FavoritesSnapshot, AppError> {
    mutate(state, app, |snap| {
        apply_rename_folder(snap, &folder_id, &name)
    })
}

pub fn move_favorite_node(
    state: &FavoritesState,
    app: &AppHandle,
    node_id: String,
    target_parent_id: Option<String>,
) -> Result<FavoritesSnapshot, AppError> {
    mutate(state, app, |snap| {
        apply_move_node(snap, &node_id, target_parent_id.as_deref())
    })
}

pub fn delete_favorite_folder(
    state: &FavoritesState,
    app: &AppHandle,
    folder_id: String,
    recursive: bool,
) -> Result<FavoritesSnapshot, AppError> {
    mutate(state, app, |snap| {
        apply_delete_folder(snap, &folder_id, recursive)
    })
}

// ─────────────────────────────────────────────────────────────────
// 测试辅助 (仅 #[cfg(test)]) — 纯逻辑路径不需要 AppHandle.
// ─────────────────────────────────────────────────────────────────

#[cfg(test)]
fn snapshot_with_folder(id: &str, parent: Option<&str>, name: &str) -> FavoriteFolder {
    FavoriteFolder {
        id: id.to_string(),
        parent_id: parent.map(|s| s.to_string()),
        name: name.to_string(),
        created_at: "2026-01-01T00:00:00Z".into(),
    }
}

#[cfg(test)]
fn snapshot_with_file(path: &str, parent: Option<&str>) -> FavoriteFile {
    FavoriteFile {
        id: file_id_for(path),
        parent_id: parent.map(|s| s.to_string()),
        path: path.to_string(),
        display_name: derive_display_name(path),
        added_at: "2026-01-01T00:00:00Z".into(),
    }
}

/// 测试用临时 .md 文件 — 每个调用生成独立目录, 避免跨用例污染.
#[cfg(test)]
struct TempMd {
    path: PathBuf,
}

#[cfg(test)]
impl TempMd {
    fn new(name: &str) -> Self {
        let unique = format!("kite-fav-test-{}-{}", std::process::id(), now_ns());
        let dir = std::env::temp_dir().join(&unique);
        fs::create_dir_all(&dir).expect("create temp dir");
        let path = dir.join(name);
        fs::write(&path, "# test note\n").expect("write temp md");
        Self { path }
    }
}

#[cfg(test)]
impl Drop for TempMd {
    fn drop(&mut self) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::remove_dir_all(parent);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── ID / 时间戳 ──────────────────────────────────────────────

    #[test]
    fn file_id_is_deterministic_and_distinct() {
        assert_eq!(file_id_for("/a/b.md"), file_id_for("/a/b.md"));
        assert_ne!(file_id_for("/a/b.md"), file_id_for("/a/c.md"));
        // 路径大小写视为不同 (macOS/Linux 大小写敏感文件系统).
        assert_ne!(file_id_for("/a/B.md"), file_id_for("/a/b.md"));
    }

    #[test]
    fn folder_ids_are_unique_across_calls() {
        let a = folder_id(None, "工作");
        let b = folder_id(None, "工作");
        assert_ne!(a, b, "同父同名不同时刻的目录 ID 必须不同 (ns 熵)");
        assert!(a.starts_with("d_"));
    }

    #[test]
    fn now_iso8601_format() {
        let s = now_iso8601();
        // 例: 2026-01-01T00:00:00Z — 固定长度 + Z 结尾.
        assert_eq!(s.len(), 20);
        assert!(s.ends_with('Z'));
    }

    #[test]
    fn epoch_to_ymdhms_known_point() {
        // 2024-03-01T00:00:00Z = 1709251200 (UTC; 2024 是闰年, 2 月有 29 天).
        let (y, mo, d, h, mi, s) = epoch_to_ymdhms(1_709_251_200);
        assert_eq!((y, mo, d, h, mi, s), (2024, 3, 1, 0, 0, 0));
    }

    // ── 目录名 / 深度 / 子树 ─────────────────────────────────────

    #[test]
    fn folder_name_validation() {
        assert_eq!(validate_folder_name("  工作  ").unwrap(), "工作");
        assert!(matches!(
            validate_folder_name("   "),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            validate_folder_name("a/b"),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            validate_folder_name("a\\b"),
            Err(AppError::InvalidPath(_))
        ));
        let long = "字".repeat(MAX_FOLDER_NAME_LEN + 1);
        assert!(matches!(
            validate_folder_name(&long),
            Err(AppError::InvalidPath(_))
        ));
    }

    #[test]
    fn subtree_and_depth_helpers() {
        let mut snap = FavoritesSnapshot::default();
        // A(根) → B → C, A → D; 文件 x 在 B 下.
        snap.folders.push(snapshot_with_folder("A", None, "a"));
        snap.folders.push(snapshot_with_folder("B", Some("A"), "b"));
        snap.folders.push(snapshot_with_folder("C", Some("B"), "c"));
        snap.folders.push(snapshot_with_folder("D", Some("A"), "d"));
        snap.files.push(snapshot_with_file("/tmp/x.md", Some("B")));

        assert_eq!(folder_depth(&snap, "C"), 3);
        assert_eq!(folder_depth(&snap, "A"), 1);
        let sub = subtree_folder_ids(&snap, "A");
        assert_eq!(sub.len(), 4);
        let sub_b = subtree_folder_ids(&snap, "B");
        assert_eq!(sub_b, HashSet::from(["B".to_string(), "C".to_string()]));
    }

    // ── add / remove ────────────────────────────────────────────

    #[test]
    fn add_favorite_creates_entry_with_canonical_path() {
        let tmp = TempMd::new("note.md");
        let canonical = tmp.path.canonicalize().unwrap();
        let cs = canonical.to_string_lossy().into_owned();
        let mut snap = FavoritesSnapshot::default();
        apply_add_favorite(&mut snap, &cs, None).unwrap();
        assert_eq!(snap.files.len(), 1);
        assert_eq!(snap.files[0].path, cs);
        assert_eq!(snap.files[0].display_name, "note.md");
        assert!(snap.files[0].id.starts_with("f_"));
    }

    #[test]
    fn add_favorite_is_idempotent_for_same_path() {
        let tmp = TempMd::new("dup.md");
        let cs = tmp
            .path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut snap = FavoritesSnapshot::default();
        apply_add_favorite(&mut snap, &cs, None).unwrap();
        // 重复添加 (哪怕目标父级不同) → 不产生第二条.
        apply_add_favorite(&mut snap, &cs, None).unwrap();
        assert_eq!(snap.files.len(), 1);
    }

    #[test]
    fn add_favorite_dedup_is_case_insensitive() {
        // 真实路径大小写: tmp.path 是 "kite-fav-test-.../Case.md".
        // canonicalize 在大小写不敏感文件系统上可能返回不同大小写,
        // 但 path_eq 必须把这些视为同一个文件, 否则会产生重复收藏.
        let tmp = TempMd::new("Case.md");
        let cs = tmp
            .path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        // 手动构造大小写反转的"同一"路径 (模拟 Windows canonicalize 行为不一致).
        let flipped: String = cs
            .chars()
            .zip(cs.to_ascii_uppercase().chars())
            .map(|(a, b)| if a.is_ascii_alphabetic() { b } else { a })
            .collect();
        assert_ne!(cs, flipped, "测试前提: 翻转后必须与原值不同");

        let mut snap = FavoritesSnapshot::default();
        apply_add_favorite(&mut snap, &cs, None).unwrap();
        // 再次 add 用翻转大小写 → 应识别为同一文件, no-op.
        apply_add_favorite(&mut snap, &flipped, None).unwrap();
        assert_eq!(snap.files.len(), 1, "大小写不敏感去重是 must-fix");
    }

    #[test]
    fn path_eq_matches_self_and_case_insensitive_variants() {
        assert!(path_eq("/a/b.md", "/a/b.md"));
        assert!(path_eq("/a/B.md", "/a/b.md"));
        assert!(path_eq("/A/b.md", "/a/B.MD"));
        assert!(!path_eq("/a/b.md", "/a/c.md"));
    }

    #[test]
    fn add_favorite_rejects_non_markdown_and_missing() {
        let tmp = TempMd::new("note.txt"); // 扩展名不符
        let cs = tmp
            .path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut snap = FavoritesSnapshot::default();
        assert!(matches!(
            apply_add_favorite(&mut snap, &cs, None),
            Err(AppError::InvalidPath(_))
        ));

        let mut snap2 = FavoritesSnapshot::default();
        assert!(matches!(
            apply_add_favorite(&mut snap2, "/definitely/missing/file.md", None),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn add_favorite_rejects_directory_target() {
        let dir =
            std::env::temp_dir().join(format!("kite-fav-dir-{}-{}", std::process::id(), now_ns()));
        fs::create_dir_all(&dir).unwrap();
        let cs = dir.to_string_lossy().into_owned();
        let mut snap = FavoritesSnapshot::default();
        assert!(matches!(
            apply_add_favorite(&mut snap, &cs, None),
            Err(AppError::InvalidPath(_))
        ));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn add_favorite_requires_existing_parent() {
        let tmp = TempMd::new("p.md");
        let cs = tmp
            .path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut snap = FavoritesSnapshot::default();
        assert!(matches!(
            apply_add_favorite(&mut snap, &cs, Some("nope")),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn remove_favorite_by_id() {
        let tmp = TempMd::new("r.md");
        let cs = tmp
            .path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut snap = FavoritesSnapshot::default();
        apply_add_favorite(&mut snap, &cs, None).unwrap();
        let id = snap.files[0].id.clone();
        apply_remove_favorite(&mut snap, &id);
        assert!(snap.files.is_empty());
        // 幂等: 再删不报错.
        apply_remove_favorite(&mut snap, &id);
    }

    // ── folder create / rename / move / delete ──────────────────

    #[test]
    fn create_folder_enforces_unique_name_per_parent() {
        let mut snap = FavoritesSnapshot::default();
        apply_create_folder(&mut snap, None, "工作").unwrap();
        // 同父同名 (含大小写) → 拒绝.
        assert!(matches!(
            apply_create_folder(&mut snap, None, "工作"),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            apply_create_folder(&mut snap, None, "工作 "),
            Err(AppError::InvalidPath(_))
        ));
        // 不同父级可以同名.
        apply_create_folder(&mut snap, None, "外层").unwrap();
        let outer = snap
            .folders
            .iter()
            .find(|f| f.name == "外层")
            .unwrap()
            .id
            .clone();
        apply_create_folder(&mut snap, Some(&outer), "工作").unwrap();
        assert_eq!(snap.folders.len(), 3);
    }

    #[test]
    fn create_folder_enforces_depth_limit() {
        let mut snap = FavoritesSnapshot::default();
        let mut parent: Option<String> = None;
        for i in 0..MAX_FOLDER_DEPTH {
            apply_create_folder(&mut snap, parent.as_deref(), &format!("lv{i}")).unwrap();
            let id = snap.folders.last().unwrap().id.clone();
            parent = Some(id);
        }
        // 第 MAX_FOLDER_DEPTH+1 层 → 拒绝.
        assert!(matches!(
            apply_create_folder(&mut snap, parent.as_deref(), "too-deep"),
            Err(AppError::InvalidPath(_))
        ));
    }

    #[test]
    fn rename_folder_updates_and_blocks_duplicate() {
        let mut snap = FavoritesSnapshot::default();
        apply_create_folder(&mut snap, None, "旧名").unwrap();
        apply_create_folder(&mut snap, None, "目标名").unwrap();
        let a = snap.folders[0].id.clone();
        assert!(matches!(
            apply_rename_folder(&mut snap, &a, "目标名"),
            Err(AppError::InvalidPath(_))
        ));
        apply_rename_folder(&mut snap, &a, "新名字").unwrap();
        assert_eq!(snap.folders[0].name, "新名字");
        // 重命名为原名 → no-op 允许.
        apply_rename_folder(&mut snap, &a, "新名字").unwrap();
    }

    #[test]
    fn move_folder_into_itself_or_descendant_rejected() {
        let mut snap = FavoritesSnapshot::default();
        // A → B → C.
        apply_create_folder(&mut snap, None, "A").unwrap();
        let a = snap.folders[0].id.clone();
        apply_create_folder(&mut snap, Some(&a), "B").unwrap();
        let b = snap.folders[1].id.clone();
        apply_create_folder(&mut snap, Some(&b), "C").unwrap();
        let c = snap.folders[2].id.clone();

        assert!(matches!(
            apply_move_node(&mut snap, &a, Some(&a)),
            Err(AppError::InvalidPath(_))
        ));
        assert!(matches!(
            apply_move_node(&mut snap, &a, Some(&c)),
            Err(AppError::InvalidPath(_))
        ));
        // 合法: B 移回根.
        apply_move_node(&mut snap, &b, None).unwrap();
        assert_eq!(snap.folders[1].parent_id, None);
    }

    #[test]
    fn move_file_to_folder_and_root() {
        let tmp = TempMd::new("mv.md");
        let cs = tmp
            .path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut snap = FavoritesSnapshot::default();
        apply_add_favorite(&mut snap, &cs, None).unwrap();
        apply_create_folder(&mut snap, None, "箱").unwrap();
        let box_id = snap.folders[0].id.clone();
        let file_id = snap.files[0].id.clone();

        apply_move_node(&mut snap, &file_id, Some(&box_id)).unwrap();
        assert_eq!(snap.files[0].parent_id.as_deref(), Some(box_id.as_str()));
        apply_move_node(&mut snap, &file_id, None).unwrap();
        assert_eq!(snap.files[0].parent_id, None);
    }

    #[test]
    fn delete_folder_non_empty_requires_recursive() {
        let tmp = TempMd::new("d.md");
        let cs = tmp
            .path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut snap = FavoritesSnapshot::default();
        apply_add_favorite(&mut snap, &cs, None).unwrap();
        apply_create_folder(&mut snap, None, "有文件").unwrap();
        let box_id = snap.folders[0].id.clone();
        let file_id = snap.files[0].id.clone();
        apply_move_node(&mut snap, &file_id, Some(&box_id)).unwrap();

        assert!(matches!(
            apply_delete_folder(&mut snap, &box_id, false),
            Err(AppError::InvalidPath(_))
        ));
        // recursive 删除: 目录与文件引用都消失.
        apply_delete_folder(&mut snap, &box_id, true).unwrap();
        assert!(snap.folders.is_empty());
        assert!(snap.files.is_empty());
    }

    #[test]
    fn delete_folder_recursive_keeps_unrelated_nodes() {
        let tmp = TempMd::new("keep.md");
        let cs = tmp
            .path
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut snap = FavoritesSnapshot::default();
        apply_add_favorite(&mut snap, &cs, None).unwrap(); // 根文件 → 保留
        apply_create_folder(&mut snap, None, "删我").unwrap();
        let box_id = snap.folders[0].id.clone();
        apply_create_folder(&mut snap, Some(&box_id), "子目录").unwrap();

        apply_delete_folder(&mut snap, &box_id, true).unwrap();
        assert_eq!(snap.folders.len(), 0);
        assert_eq!(snap.files.len(), 1);
        assert!(snap.files[0].parent_id.is_none());
    }

    // ── sanitize ────────────────────────────────────────────────

    fn payload(folders: Vec<FavoriteFolder>, files: Vec<FavoriteFile>) -> FavoritesStorePayload {
        FavoritesStorePayload {
            version: FAVORITES_SCHEMA_VERSION,
            folders,
            files,
        }
    }

    #[test]
    fn sanitize_drops_dangling_and_duplicate_paths() {
        let p = payload(
            vec![
                // parent 不存在 → 丢弃.
                snapshot_with_folder("B", Some("missing"), "b"),
                // 合法.
                snapshot_with_folder("A", None, "a"),
                // id 重复 → 只留一条.
                snapshot_with_folder("A", None, "a-dup"),
            ],
            vec![
                snapshot_with_file("/x/a.md", Some("B")), // 父目录被清掉 → 丢弃
                snapshot_with_file("/x/b.md", None),
                snapshot_with_file("/x/b.md", None), // 同 path 重复 → 只留一条
                FavoriteFile {
                    id: String::new(),
                    parent_id: None,
                    path: "/x/c.md".into(),
                    display_name: "c.md".into(),
                    added_at: String::new(),
                }, // id 空 → 丢弃
            ],
        );
        let out = sanitize(&p);
        assert_eq!(out.folders.len(), 1);
        assert_eq!(out.folders[0].id, "A");
        assert_eq!(out.files.len(), 1);
        assert_eq!(out.files[0].path, "/x/b.md");
    }

    #[test]
    fn sanitize_breaks_cycles() {
        // A → B → A 成环; C 独立.
        let p = payload(
            vec![
                snapshot_with_folder("A", Some("B"), "a"),
                snapshot_with_folder("B", Some("A"), "b"),
                snapshot_with_folder("C", None, "c"),
            ],
            vec![snapshot_with_file("/x/a.md", Some("A"))],
        );
        let out = sanitize(&p);
        let ids: HashSet<String> = out.folders.iter().map(|f| f.id.clone()).collect();
        assert!(
            !ids.contains("A") && !ids.contains("B"),
            "环上节点必须被清理"
        );
        assert!(ids.contains("C"));
        assert!(out.files.is_empty(), "挂在环目录下的文件引用必须随之清理");
    }

    #[test]
    fn sanitize_trims_to_max_nodes() {
        let files: Vec<FavoriteFile> = (0..(MAX_FAVORITE_NODES + 5))
            .map(|i| snapshot_with_file(&format!("/x/{i}.md"), None))
            .collect();
        let p = payload(Vec::new(), files);
        let out = sanitize(&p);
        assert_eq!(out.folders.len() + out.files.len(), MAX_FAVORITE_NODES);
    }

    // ── serde 形状 (与 TS 契约) ────────────────────────────────

    #[test]
    fn snapshot_serializes_camel_case_with_null_parent() {
        let mut snap = FavoritesSnapshot::default();
        snap.files.push(snapshot_with_file("/x/a.md", None));
        let json = serde_json::to_string(&snap).unwrap();
        assert!(
            json.contains("\"parentId\":null"),
            "TS 端按 string|null 解析, null 必须出现"
        );
        assert!(json.contains("\"displayName\""));
        assert!(json.contains("\"addedAt\""));
        assert!(json.contains("\"version\":1"));

        // 反序列化: 缺 parentId 字段也合法.
        let raw = r#"{"version":1,"folders":[],"files":[{"id":"f_1","path":"/x/a.md","displayName":"a.md","addedAt":"2026-01-01T00:00:00Z"}]}"#;
        let back: FavoritesSnapshot = serde_json::from_str(raw).unwrap();
        assert_eq!(back.files[0].parent_id, None);
    }
}

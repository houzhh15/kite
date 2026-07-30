import { test, expect } from '@playwright/test';

const AIDG_FLOWCHART = `graph TD
    subgraph E["外部依赖"]
        E1("LLM 服务");
        E2("AI Agent");
    end
    subgraph D["开发者"]
        D1("人工操作");
    end
    subgraph B["AIDG 系统"]
        B_Web("Web 界面<br/>项目/任务管理");
        B_MCP("MCP Server<br/>AI 接口");
        B1("知识中心<br/>文档/架构");
        B2("任务中心<br/>需求/设计/计划");
    end
    D1 -- "①绑定任务" --> B_Web;
    D1 -- "②发出指令" --> E2;
    E2 -- "③(MCP)获取上下文" --> B_MCP;
    B_MCP -- "④返回项目知识" --> E2;
    B1 -."提供数据".-> B_MCP;
    B2 -."提供数据".-> B_MCP;
    E2 -- "⑤记录提示词" --> B_MCP;
    E2 -- "⑥调用 LLM" --> E1;
    E1 -- "⑦返回结果" --> E2;
    E2 -- "⑧呈现给用户" --> D1;
    D1 -- "⑨评审确认" --> B_Web;
    B_Web -- "⑩知识回流" --> B1;`;

test.describe('Mermaid SVG labels', () => {
  test('real Mermaid output keeps node labels without foreignObject', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async (code) => {
      const mermaid = (await import('mermaid')).default;
      const { sanitizeSvg } = await import('/src/lib/svgSanitizer.ts');
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        flowchart: { htmlLabels: false },
      });
      const { svg } = await mermaid.render(`kite-labels-${Date.now()}`, code);
      const clean = sanitizeSvg(svg);
      const document = new DOMParser().parseFromString(clean, 'image/svg+xml');
      return {
        text: document.documentElement.textContent ?? '',
        nodeTextCount: document.querySelectorAll('g.node text').length,
        foreignObjectCount: document.querySelectorAll('foreignObject').length,
      };
    }, AIDG_FLOWCHART);

    expect(result.foreignObjectCount).toBe(0);
    expect(result.nodeTextCount).toBeGreaterThan(0);
    for (const label of [
      'LLM 服务',
      'AI Agent',
      '人工操作',
      'Web 界面',
      '项目/任务管理',
      'MCP Server',
      'AI 接口',
      '知识中心',
      '文档/架构',
    ]) {
      expect(result.text).toContain(label);
    }
  });
});

test.describe('KaTeX plugin chain', () => {
  test('KaTeX plugin is always present', async ({ page }) => {
    await page.goto('/');
    const pluginCount = await page.evaluate(async () => {
      const mod = await import('/src/lib/pipeline.ts');
      return mod.buildRehypePlugins().length;
    });
    expect(pluginCount).toBeGreaterThan(1);
  });
});

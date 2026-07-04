/**
 * ErrorBoundary — React 类组件, 透传 componentDidCatch 到 props.onError.
 *
 * 设计依据: docs/design/compiled.md §3.3.3 + §5.1.
 *
 *   - 不引入额外副作用 (不 toast, 不写 store).
 *   - 错误统一由父级通过 onError 收到, 自行决定派发 OPEN_ERR 或 toast.
 *   - fallback: 在 React 16+ 标准实践下, 默认渲染 null 然后让
 *     useMarkdownDoc dispatch OPEN_ERR 切到 ErrorView.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** 触发时由 App.tsx 注入; 这里只是中转. */
  onError: (err: Error, info: ErrorInfo) => void;
}

export interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default ErrorBoundary;

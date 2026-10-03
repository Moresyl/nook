import React from 'react';
import { createRoot } from 'react-dom/client';
import { Workbench } from './workbench';
import './theme/reference-tokens.css';
import './theme/reference-fonts.css';
import './theme/reference-math.css';
import './theme/surfaces.css';
import './theme/rich-content.css';

class Boundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="startup"><h1>界面暂时无法显示</h1><p>你的本地数据仍保存在工作台中。重新启动应用后再试。</p></div>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Boundary><Workbench /></Boundary></React.StrictMode>);

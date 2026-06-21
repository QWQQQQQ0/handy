import React from 'react';
import ReactDOM from 'react-dom/client';
import { enableMapSet } from 'immer';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import './index.css';

// 初始化全局状态管理器
import { globalState } from './services/global-state';

// 挂载到 window 方便调试
if (typeof window !== 'undefined') {
  (window as any).__globalState = globalState;
}

enableMapSet();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

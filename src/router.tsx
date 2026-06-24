import { createBrowserRouter } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { PageSkeleton } from '@/components/page-skeleton';

const ChatPage = lazy(() => import('@/pages/chat'));
const DesktopPage = lazy(() => import('@/pages/desktop'));
const FloatPage = lazy(() => import('@/pages/float'));
const WebPage = lazy(() => import('@/pages/web'));
const PhonePage = lazy(() => import('@/pages/phone'));
const ModelsPage = lazy(() => import('@/pages/models'));
const SkillsPage = lazy(() => import('@/pages/skills'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const AppsPage = lazy(() => import('@/pages/apps'));
const ScheduledTasksPage = lazy(() => import('@/pages/watchers'));  // file rename pending, component still watchers.tsx
const KnowledgePage = lazy(() => import('@/pages/knowledge'));
const AgentsPage = lazy(() => import('@/pages/agents'));
const TasksPage = lazy(() => import('@/pages/tasks'));
const FreeAgentPage = lazy(() => import('@/pages/free-agent'));

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  // Standalone route: float window (no AppShell — it's a separate Tauri WebviewWindow)
  {
    path: '/float',
    element: (
      <Lazy>
        <FloatPage />
      </Lazy>
    ),
  },
  // Main app routes: wrapped in AppShell (sidebar + header)
  {
    element: <AppShell />,
    children: [
      {
        path: '/',
        element: (
          <Lazy>
            <ChatPage />
          </Lazy>
        ),
      },
      {
        path: '/desktop',
        element: (
          <Lazy>
            <DesktopPage />
          </Lazy>
        ),
      },
      {
        path: '/web',
        element: (
          <Lazy>
            <WebPage />
          </Lazy>
        ),
      },
      {
        path: '/phone',
        element: (
          <Lazy>
            <PhonePage />
          </Lazy>
        ),
      },
      {
        path: '/models',
        element: (
          <Lazy>
            <ModelsPage />
          </Lazy>
        ),
      },
      {
        path: '/skills',
        element: (
          <Lazy>
            <SkillsPage />
          </Lazy>
        ),
      },
      {
        path: '/settings',
        element: (
          <Lazy>
            <SettingsPage />
          </Lazy>
        ),
      },
      {
        path: '/apps',
        element: (
          <Lazy>
            <AppsPage />
          </Lazy>
        ),
      },
      {
        path: '/scheduled-tasks',
        element: (
          <Lazy>
            <ScheduledTasksPage />
          </Lazy>
        ),
      },
      {
        path: '/knowledge',
        element: (
          <Lazy>
            <KnowledgePage />
          </Lazy>
        ),
      },
      {
        path: '/agents',
        element: (
          <Lazy>
            <AgentsPage />
          </Lazy>
        ),
      },
      {
        path: '/tasks',
        element: (
          <Lazy>
            <TasksPage />
          </Lazy>
        ),
      },
      {
        path: '/free-agent',
        element: (
          <Lazy>
            <FreeAgentPage />
          </Lazy>
        ),
      },
    ],
  },
]);

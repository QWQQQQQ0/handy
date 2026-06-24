import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AppWindow, Play, Code, Trash2, RefreshCw, Eye, EyeOff,
  Save, Plus, Search, Folder, File, ChevronRight, ChevronDown,
  PanelLeftClose, PanelLeft, FolderOpen, Import,
  Send, Bot, User, LoaderCircle, Wrench, Square,
} from 'lucide-react';
import { useT } from '@/i18n/strings';
import { getDB } from '@/db';
import { codeSandboxService } from '@/services/code-sandbox';
import { appEvents, APP_EVENTS } from '@/services/app-events';
import { useProjectStore } from '@/stores/project-store';
import type { ActiveProject } from '@/stores/project-store';
import { useModelConfigStore } from '@/stores/model-config-store';
import { AgentEndpoint } from '@/api/types';
import { runAgentLoop } from '@/services/agent-loop';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import type { LLMMessage } from '@/types/message';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Save a project chat message to DB (conversation_id = project ID). */
async function saveProjectChatMsg(
  projectId: string,
  msg: { role: string; content: string; toolCalls?: string[] },
) {
  try {
    const db = await getDB();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const toolCallsJson = msg.toolCalls?.length ? JSON.stringify(msg.toolCalls) : null;
    await db.execute(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_calls, agent_internal, agent_type)
       VALUES (?, ?, ?, ?, ?, ?, 0, '')`,
      [id, projectId, msg.role, msg.content, now, toolCallsJson],
    );
  } catch { /* non-critical */ }
}

/** Load project chat messages from DB. */
async function loadProjectChatMsgs(projectId: string): Promise<ChatMessage[]> {
  try {
    const db = await getDB();
    const rows = await db.query<{ role: string; content: string; tool_calls: string | null }>(
      'SELECT role, content, tool_calls FROM messages WHERE conversation_id = ? AND agent_internal = 0 ORDER BY timestamp ASC',
      [projectId],
    );
    return rows.map((r) => ({
      role: (r.role === 'user' || r.role === 'assistant') ? r.role : 'assistant',
      content: r.content,
      toolCalls: (() => { try { return r.tool_calls ? JSON.parse(r.tool_calls) : []; } catch { return []; } })(),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls: string[];  // tool call summaries shown inline
}

interface SavedProject {
  id: string;
  name: string;
  code: string;
  created_at: string;
  description?: string;
  project_type?: string;
  files_json?: string;
  entry_file?: string;
  source_type?: string;
  local_path?: string;
}

interface PreviewState {
  projectId: string | null;
  htmlContent: string;
  isolatedDocument: string;
  isFullscreen: boolean;
}

interface ProjectFiles {
  [path: string]: string;
}

// ---------------------------------------------------------------------------
// File Explorer Component (for imported projects — reads from disk)
// ---------------------------------------------------------------------------

interface DiskEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}

function DiskFileExplorer({
  localPath,
  activeFilePath,
  onFileSelect,
}: {
  localPath: string;
  activeFilePath: string;
  onFileSelect: (diskPath: string, fileName: string) => void;
}) {
  const [tree, setTree] = useState<DiskEntry[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set([localPath]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(async (dirPath: string): Promise<DiskEntry[]> => {
    try {
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(dirPath);
      const result: DiskEntry[] = [];
      for (const e of entries) {
        const fullPath = `${dirPath.replace(/\\+$/, '').replace(/\/+$/, '')}/${e.name}`;
        result.push({
          name: e.name,
          path: fullPath,
          isDirectory: e.isDirectory ?? false,
          isFile: e.isFile ?? true,
        });
      }
      return result;
    } catch {
      // Fallback: use invoke
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const entries = await invoke<Array<{ name: string; path: string; is_directory: boolean; is_file: boolean }>>('list_dir', { path: dirPath });
        return entries.map((e) => ({
          name: e.name,
          path: e.path,
          isDirectory: e.is_directory,
          isFile: e.is_file,
        }));
      } catch {
        throw new Error(`Cannot read directory: ${dirPath}`);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const entries = await loadDir(localPath);
      // Sort: directories first, then files (both alphabetically)
      entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      // Filter hidden files
      const filtered = entries.filter((e) => !e.name.startsWith('.'));
      setTree(filtered);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [localPath, loadDir]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleDir = async (dirPath: string) => {
    if (expandedDirs.has(dirPath)) {
      setExpandedDirs((prev) => { const n = new Set(prev); n.delete(dirPath); return n; });
    } else {
      setExpandedDirs((prev) => new Set(prev).add(dirPath));
    }
  };

  const renderTree = (entries: DiskEntry[], depth: number) => (
    entries.map((entry) => (
      <div key={entry.path}>
        <button
          onClick={() => {
            if (entry.isDirectory) {
              toggleDir(entry.path);
            } else {
              onFileSelect(entry.path, entry.name);
            }
          }}
          className={`w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            activeFilePath === entry.path ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : ''
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {entry.isDirectory ? (
            <>
              {expandedDirs.has(entry.path) ? (
                <ChevronDown size={10} className="text-zinc-400" />
              ) : (
                <ChevronRight size={10} className="text-zinc-400" />
              )}
              <Folder size={12} className="text-yellow-500" />
            </>
          ) : (
            <>
              <span className="w-[10px]" />
              <File size={12} className="text-zinc-400" />
            </>
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {entry.isDirectory && expandedDirs.has(entry.path) && (
          <SubDirLoader
            dirPath={entry.path}
            depth={depth + 1}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            loadDir={loadDir}
          />
        )}
      </div>
    ))
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-400">
        <RefreshCw size={14} className="animate-spin mr-2" />
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 text-[11px] text-red-500">
        {error}
        <button onClick={refresh} className="ml-2 text-blue-500 hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Files</span>
        <button onClick={refresh} className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400" title="Refresh">
          <RefreshCw size={10} />
        </button>
      </div>
      {tree.length === 0 ? (
        <p className="p-3 text-[11px] text-zinc-400">Empty directory</p>
      ) : (
        renderTree(tree, 0)
      )}
    </div>
  );
}

/** Lazy-loads subdirectory contents when expanded. */
function SubDirLoader({
  dirPath, depth, activeFilePath, onFileSelect, loadDir,
}: {
  dirPath: string; depth: number; activeFilePath: string;
  onFileSelect: (diskPath: string, fileName: string) => void;
  loadDir: (dirPath: string) => Promise<DiskEntry[]>;
}) {
  const [entries, setEntries] = useState<DiskEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadDir(dirPath).then((result) => {
      if (cancelled) return;
      result.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(result.filter((e) => !e.name.startsWith('.')));
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setEntries([]); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [dirPath, loadDir]);

  if (loading) return <p className="text-[10px] text-zinc-400" style={{ paddingLeft: `${depth * 12 + 20}px` }}>...</p>;
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map((entry) => (
        <div key={entry.path}>
          <button
            onClick={() => {
              if (entry.isDirectory) {
                // For sub-dirs we'd need recursive expansion; for simplicity treat as leaf
              } else {
                onFileSelect(entry.path, entry.name);
              }
            }}
            className={`w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              activeFilePath === entry.path ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : ''
            }`}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            {entry.isDirectory ? (
              <>
                <span className="w-[10px]" />
                <Folder size={12} className="text-yellow-500" />
              </>
            ) : (
              <>
                <span className="w-[10px]" />
                <File size={12} className="text-zinc-400" />
              </>
            )}
            <span className="truncate">{entry.name}</span>
          </button>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Code Editor Component
// ---------------------------------------------------------------------------

function CodeEditor({
  code,
  onChange,
  language = 'text',
}: {
  code: string;
  onChange: (code: string) => void;
  language?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = code.substring(0, start) + '  ' + code.substring(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  // Detect language from file extension
  const ext = language.split('.').pop()?.toLowerCase() || language;
  const langLabel: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
    py: 'Python', html: 'HTML', css: 'CSS', json: 'JSON',
    md: 'Markdown', rs: 'Rust', sql: 'SQL',
  };

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-zinc-800 dark:bg-zinc-700 rounded text-[10px] text-zinc-400 z-10">
        <Code size={10} />
        {langLabel[ext] || ext.toUpperCase() || 'Plain'}
      </div>
      <textarea
        ref={textareaRef}
        value={code}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full h-full p-4 pt-8 font-mono text-[13px] leading-relaxed bg-zinc-900 text-zinc-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        spellCheck={false}
        placeholder="Select a file to edit..."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// HTML Preview Component (for generated projects)
// ---------------------------------------------------------------------------

function HTMLPreview({
  isolatedDocument,
  onConsoleLog,
}: {
  htmlContent: string;
  isolatedDocument: string;
  onConsoleLog?: (logs: string[]) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = isolatedDocument;

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'sandbox-log' && onConsoleLog) {
        onConsoleLog(event.data.logs);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isolatedDocument, onConsoleLog]);

  return (
    <iframe
      ref={iframeRef}
      title="HTML Preview"
      sandbox="allow-scripts allow-modals"
      className="w-full h-full border-0 bg-white"
      style={{ minHeight: '400px' }}
    />
  );
}

// ---------------------------------------------------------------------------
// Project Card Component
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  isSelected,
  isActive,
  onSelect,
  onDelete,
}: {
  project: SavedProject;
  isSelected: boolean;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const createdDate = new Date(project.created_at).toLocaleDateString();
  const isGenerated = project.source_type !== 'imported';
  const isMultiFile = project.project_type === 'multi';

  return (
    <div
      onClick={onSelect}
      className={`group relative p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
          : isActive
          ? 'border-green-400 bg-green-50 dark:bg-green-900/10'
          : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${isSelected ? 'bg-blue-100 dark:bg-blue-800' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
          {isGenerated ? (
            isMultiFile ? (
              <Folder size={16} className={isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-yellow-500'} />
            ) : (
              <AppWindow size={16} className={isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-500'} />
            )
          ) : (
            <FolderOpen size={16} className={isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-green-500'} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {project.name}
            </h3>
            <span className={`px-1.5 py-0.5 rounded text-[9px] ${
              isGenerated
                ? 'bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400'
                : 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400'
            }`}>
              {isGenerated ? t('projects.sourceGenerated') : t('projects.sourceImported')}
            </span>
            {isActive && (
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">
                {t('projects.active')}
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            {createdDate}
          </p>
          {!isGenerated && project.local_path && (
            <p className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5 truncate">
              {project.local_path}
            </p>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-zinc-400 hover:text-red-500 transition-all"
          title={isGenerated ? 'Delete project' : 'Remove from list (files stay on disk)'}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Executor cache — lazy-init once, reused across chat sends
// ---------------------------------------------------------------------------

let _executorCache: ISkillExecutor | null = null;

async function getOrCreateExecutor(provider?: { id: string; name: string; type: string; baseUrl: string; model: string }, apiKey?: string): Promise<ISkillExecutor> {
  const { useSkillStore } = await import('@/stores/skill-store');
  const skillStore = useSkillStore.getState();
  await skillStore.initializeSkills();

  const { initBuiltinExecutor, setCodeToolsModelService } = await import('@/skills/builtin-executor');
  const dbConfigs = skillStore.allConfigs.filter((c) => c.builtin);
  const executor = await initBuiltinExecutor(dbConfigs);

  // Apply disabled tools
  const { useSettingsStore } = await import('@/stores/settings-store');
  executor.disabledTools = useSettingsStore.getState().disabledTools;

  // Configure CodeTools with ModelService (needed for generate_code, etc.)
  if (provider && apiKey) {
    const { getModelService } = await import('@/services/model-service-singleton');
    setCodeToolsModelService(getModelService(), {
      id: provider.id,
      name: provider.name,
      type: provider.type as 'openai' | 'anthropic' | 'google',
      baseUrl: provider.baseUrl,
      model: provider.model,
      encryptedApiKey: apiKey,
      isDefault: false,
      supportsTools: true,
      createdAt: '',
    }, apiKey);
  }

  // Register user-defined skills
  for (const skill of skillStore.getUserSkillInstances()) {
    if (skill.config.exposedToAI === false) continue;
    skill.setExecutor(executor);
    executor.register(skill);
  }

  _executorCache = executor;
  return executor;
}

// ---------------------------------------------------------------------------
// Main Projects Page
// ---------------------------------------------------------------------------

export default function AppsPage() {
  const t = useT();
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const clearActiveProject = useProjectStore((s) => s.clearActiveProject);
  const activeProject = useProjectStore((s) => s.activeProject);

  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProject, setSelectedProject] = useState<SavedProject | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedCode, setEditedCode] = useState('');
  const [activeFileRelPath, setActiveFileRelPath] = useState(''); // relative path within imported project
  const [preview, setPreview] = useState<PreviewState>({
    projectId: null,
    htmlContent: '',
    isolatedDocument: '',
    isFullscreen: false,
  });
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Chat state ──
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessage[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Per-project LLM message history (accumulates across sends for conversation context)
  const chatHistoriesRef = useRef<Record<string, LLMMessage[]>>({});

  // ── Load projects from DB ──
  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDB();
      const rows = await db.query<SavedProject>(
        'SELECT id, name, code, description, project_type, source_type, local_path, files_json, entry_file, created_at FROM savedApps ORDER BY created_at DESC'
      );
      setProjects(rows);
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // ── Process HTML preview (generated projects only) ──
  const processForPreview = useCallback(async (project: SavedProject) => {
    try {
      let htmlContent = project.code;

      if (project.project_type === 'multi' && project.files_json) {
        try {
          const files = JSON.parse(project.files_json);
          const entry = project.entry_file || Object.keys(files).find((f: string) => f.endsWith('.html')) || Object.keys(files)[0];
          if (entry && files[entry]) htmlContent = files[entry];
        } catch { /* use raw code */ }
      }

      const result = await codeSandboxService.execute('html', htmlContent, undefined, {
        allowExternalResources: true,
      });

      if (result.success && result.isolatedDocument) {
        setPreview({
          projectId: project.id,
          htmlContent: result.htmlContent || htmlContent,
          isolatedDocument: result.isolatedDocument,
          isFullscreen: false,
        });
        setConsoleLogs([]);
      }
    } catch (err) {
      console.error('Failed to process HTML:', err);
    }
  }, []);

  // ── Listen for real-time app updates ──
  useEffect(() => {
    const handleAppCreated = (event: unknown) => {
      const { id, name, code, created_at } = event as {
        id: string; name: string; code: string; created_at: string;
      };
      const newProject: SavedProject = { id, name, code, created_at, source_type: 'generated' };
      setProjects((prev) => [newProject, ...prev]);
      setSelectedProject(newProject);
      setEditedCode(code);
      processForPreview(newProject);
    };

    const handleHTMLGenerated = () => { loadProjects(); };

    const unsubCreated = appEvents.on(APP_EVENTS.APP_CREATED, handleAppCreated);
    const unsubHTML = appEvents.on(APP_EVENTS.HTML_GENERATED, handleHTMLGenerated);

    return () => { unsubCreated(); unsubHTML(); };
  }, [loadProjects, processForPreview]);

  // ── Select a project ──
  const handleSelectProject = useCallback(async (project: SavedProject) => {
    setSelectedProject(project);
    setEditMode(false);
    setActiveFileRelPath('');

    // Set as active project in global store
    const ap: ActiveProject = {
      id: project.id,
      name: project.name,
      sourceType: (project.source_type === 'imported') ? 'imported' : 'generated',
      localPath: project.local_path || '',
    };
    setActiveProject(ap);

    // Load chat history from DB (if not already loaded)
    if (!chatMessages[project.id]) {
      const msgs = await loadProjectChatMsgs(project.id);
      if (msgs.length > 0) {
        setChatMessages((prev) => ({ ...prev, [project.id]: msgs }));
        // Rebuild LLM history from loaded messages
        const history: LLMMessage[] = [];
        for (const m of msgs) {
          history.push({ role: m.role, content: m.content });
          if (m.toolCalls.length > 0) {
            history.push({ role: 'assistant', content: m.content, toolCalls: m.toolCalls.map((tc: string, i: number) => ({ id: `hist_${i}`, function: { name: tc, arguments: '{}' } })) as any });
          }
        }
        chatHistoriesRef.current[project.id] = history;
      }
    }

    if (project.source_type === 'imported') {
      // Imported project: clear preview, show file explorer
      setPreview({ projectId: null, htmlContent: '', isolatedDocument: '', isFullscreen: false });
    } else {
      // Generated project: HTML preview
      setEditedCode(project.code);
      await processForPreview(project);
    }
  }, [setActiveProject, processForPreview, chatMessages]);

  // ── Read file from disk (imported project) ──
  const handleOpenFile = useCallback(async (diskPath: string, fileName: string) => {
    if (!selectedProject || selectedProject.source_type !== 'imported') return;
    setActiveFileRelPath(diskPath);
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const content = await readTextFile(diskPath);
      setEditedCode(content);
      setEditMode(true);
    } catch {
      // Fallback: invoke
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const content = await invoke<string>('read_file', { path: diskPath });
        setEditedCode(content);
        setEditMode(true);
      } catch (e) {
        setEditedCode(`// Error reading file: ${e instanceof Error ? e.message : String(e)}`);
        setEditMode(true);
      }
    }
  }, [selectedProject]);

  // ── Refresh preview ──
  const handleRefreshPreview = useCallback(async () => {
    if (selectedProject) await processForPreview(selectedProject);
  }, [selectedProject, processForPreview]);

  // ── Save edited code ──
  const handleSaveCode = useCallback(async () => {
    if (!selectedProject) return;

    try {
      if (selectedProject.source_type === 'imported' && activeFileRelPath) {
        // Write to disk
        try {
          const { writeTextFile } = await import('@tauri-apps/plugin-fs');
          await writeTextFile(activeFileRelPath, editedCode);
        } catch {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('write_file', { path: activeFileRelPath, content: editedCode });
        }
        setSaveMessage({ type: 'ok', text: `Saved: ${activeFileRelPath}` });
      } else {
        // Update DB
        const db = await getDB();
        await db.execute('UPDATE savedApps SET code = ? WHERE id = ?', [editedCode, selectedProject.id]);
        const updated = { ...selectedProject, code: editedCode };
        setSelectedProject(updated);
        setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        await processForPreview(updated);
        setSaveMessage({ type: 'ok', text: 'Code saved successfully' });
      }
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'err', text: `Failed to save: ${err}` });
      setTimeout(() => setSaveMessage(null), 3000);
    }
  }, [selectedProject, activeFileRelPath, editedCode, processForPreview]);

  // ── Delete project ──
  const handleDeleteProject = useCallback(async (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    const isImported = project?.source_type === 'imported';
    const msg = isImported
      ? 'Remove this project from the list? Files on disk will NOT be deleted.'
      : 'Are you sure you want to delete this project?';
    if (!confirm(msg)) return;

    try {
      const db = await getDB();
      await db.execute('DELETE FROM savedApps WHERE id = ?', [projectId]);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));

      if (selectedProject?.id === projectId) {
        setSelectedProject(null);
        setPreview({ projectId: null, htmlContent: '', isolatedDocument: '', isFullscreen: false });
        setEditedCode('');
        setActiveFileRelPath('');
      }
      if (activeProject?.id === projectId) {
        clearActiveProject();
      }
      // Clean up chat history for deleted project
      delete chatHistoriesRef.current[projectId];
      setChatMessages((prev) => { const n = { ...prev }; delete n[projectId]; return n; });
      setSaveMessage({ type: 'ok', text: 'Project removed' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'err', text: `Failed to delete: ${err}` });
      setTimeout(() => setSaveMessage(null), 3000);
    }
  }, [projects, selectedProject, activeProject, clearActiveProject]);

  // ── Create new generated project ──
  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    const defaultCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${newProjectName}</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      color: white;
    }
    h1 { font-size: 2.5rem; margin-bottom: 1rem; }
    p { font-size: 1.2rem; opacity: 0.9; }
    .card {
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 2rem;
      margin-top: 2rem;
    }
  </style>
</head>
<body>
  <h1>Welcome to ${newProjectName}</h1>
  <p>This is your new project. Start editing to customize it!</p>
  <div class="card">
    <h2>Getting Started</h2>
    <p>Edit the HTML, CSS, and JavaScript to build your project.</p>
  </div>
</body>
</html>`;

    try {
      const db = await getDB();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        'INSERT INTO savedApps (id, name, code, source_type, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, newProjectName.trim(), defaultCode, 'generated', now]
      );
      const newProject: SavedProject = { id, name: newProjectName.trim(), code: defaultCode, created_at: now, source_type: 'generated' };
      setProjects((prev) => [newProject, ...prev]);
      setSelectedProject(newProject);
      setEditedCode(defaultCode);
      setIsCreating(false);
      setNewProjectName('');
      await processForPreview(newProject);

      // Set as active
      setActiveProject({ id: newProject.id, name: newProject.name, sourceType: 'generated', localPath: '' });

      setSaveMessage({ type: 'ok', text: 'Project created successfully' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'err', text: `Failed to create: ${err}` });
      setTimeout(() => setSaveMessage(null), 3000);
    }
  }, [newProjectName, processForPreview, setActiveProject]);

  // ── Open native folder picker ──
  const selectFolderDialog = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, title: 'Select project folder' });
      if (selected && typeof selected === 'string') {
        setImportPath(selected);
        setImportError(null);
      }
    } catch {
      // plugin-dialog not available (web fallback) — user types path manually
    }
  }, []);

  // ── Import folder ──
  const handleImportFolder = useCallback(async () => {
    const trimmed = importPath.trim();
    if (!trimmed) return;
    setImportError(null);

    // Validate path exists
    try {
      const { readDir } = await import('@tauri-apps/plugin-fs');
      await readDir(trimmed);
    } catch {
      setImportError('Folder not found or cannot be read. Please check the path.');
      return;
    }

    // Extract folder name as project name
    const folderName = trimmed.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || trimmed;

    try {
      const db = await getDB();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        'INSERT INTO savedApps (id, name, code, description, source_type, local_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, folderName, '', `Imported from ${trimmed}`, 'imported', trimmed, now]
      );
      const newProject: SavedProject = {
        id, name: folderName, code: '', created_at: now,
        source_type: 'imported', local_path: trimmed, description: `Imported from ${trimmed}`,
      };
      setProjects((prev) => [newProject, ...prev]);
      setSelectedProject(newProject);
      setEditedCode('');
      setActiveFileRelPath('');
      setPreview({ projectId: null, htmlContent: '', isolatedDocument: '', isFullscreen: false });
      setIsImporting(false);
      setImportPath('');

      // Set as active
      setActiveProject({ id: newProject.id, name: newProject.name, sourceType: 'imported', localPath: trimmed });

      setSaveMessage({ type: 'ok', text: `Imported: ${folderName}` });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setImportError(`Failed to import: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [importPath, setActiveProject]);

  // ── Send chat message to code agent (multi-turn, user-stoppable) ──
  const handleChatSend = useCallback(async () => {
    const input = chatInput.trim();
    if (!input || !selectedProject) return;
    setChatInput('');
    setChatLoading(true);

    // Create abort controller so user can stop mid-run
    const abortController = new AbortController();
    chatAbortRef.current = abortController;

    const pid = selectedProject.id;

    // ── Get API key ──
    const modelStore = useModelConfigStore.getState();
    const providers = modelStore.providers;
    const defaultProv = providers.find((p) => p.isDefault) || providers[0];
    if (!defaultProv) {
      setChatMessages((prev) => ({
        ...prev, [pid]: [...(prev[pid] || []), { role: 'assistant', content: '❌ 没有配置模型，请先在「模型」页面添加一个模型提供商。', toolCalls: [] }],
      }));
      setChatLoading(false);
      return;
    }
    let apiKey: string;
    try { apiKey = await modelStore.getApiKey(defaultProv.id, ''); } catch {
      setChatMessages((prev) => ({
        ...prev, [pid]: [...(prev[pid] || []), { role: 'assistant', content: '❌ 无法解密 API Key，请在模型设置中重新保存。', toolCalls: [] }],
      }));
      setChatLoading(false);
      return;
    }

    // ── Build project context (only on first message of a conversation) ──
    const isImported = selectedProject.source_type === 'imported';
    const existingHistory = chatHistoriesRef.current[pid];
    const isFirstMessage = !existingHistory || existingHistory.length === 0;

    let userContent: string;
    if (isFirstMessage) {
      userContent = `[当前项目]\n项目名: ${selectedProject.name}\n类型: ${isImported ? '导入的外部项目' : '生成的项目'}`;
      if (isImported && selectedProject.local_path) {
        userContent += `\n工作目录: ${selectedProject.local_path}`;
      }
      userContent += `\n\n${input}`;
    } else {
      userContent = input;
    }

    // ── LLM messages — reuse existing history, append new user message ──
    const llmMessages: LLMMessage[] = [
      ...(existingHistory || []),
      { role: 'user', content: userContent },
    ];

    // ── Add user message to visible UI + DB ──
    const userMsg: ChatMessage = { role: 'user', content: input, toolCalls: [] };
    setChatMessages((prev) => {
      const msgs = [...(prev[pid] || []), userMsg];
      return { ...prev, [pid]: msgs };
    });
    saveProjectChatMsg(pid, userMsg);  // fire-and-forget persist

    // ── Set up executor ──
    let executor: ISkillExecutor;
    try {
      executor = await getOrCreateExecutor(defaultProv, apiKey);
    } catch (e) {
      setChatMessages((prev) => ({
        ...prev, [pid]: [...(prev[pid] || []), { role: 'assistant', content: `❌ 初始化工具执行器失败: ${e instanceof Error ? e.message : String(e)}`, toolCalls: [] }],
      }));
      setChatLoading(false);
      return;
    }

    // ── Assistant placeholder for real-time streaming ──
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', toolCalls: [] };
    setChatMessages((prev) => ({ ...prev, [pid]: [...(prev[pid] || []), assistantMsg] }));

    // Track tool calls + final content for DB save
    const allToolLabels: string[] = [];
    let lastContent = '';

    try {
      await runAgentLoop(llmMessages, {
        endpoint: AgentEndpoint.codeAgent,
        provider: defaultProv,
        apiKey,
        executor,
        maxRounds: 999,   // project dev needs many rounds; user stops manually
        abortSignal: abortController.signal,
        onText: (cumulative) => {
          lastContent = cumulative;
          // Real-time streaming update
          setChatMessages((prev) => {
            const msgs = [...(prev[pid] || [])];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              last.content = cumulative;
            }
            return { ...prev, [pid]: msgs };
          });
        },
        onToolCall: (name, args) => {
          const label = `🔧 ${name} ${JSON.stringify(args).substring(0, 80)}`;
          allToolLabels.push(label);
          setChatMessages((prev) => {
            const msgs = [...(prev[pid] || [])];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              last.toolCalls = [...last.toolCalls, label];
            }
            return { ...prev, [pid]: msgs };
          });
        },
      });
    } catch (e) {
      setChatMessages((prev) => {
        const msgs = [...(prev[pid] || [])];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          last.content = last.content || `❌ 请求失败: ${e instanceof Error ? e.message : String(e)}`;
        }
        return { ...prev, [pid]: msgs };
      });
    }

    // Ensure content is never empty
    setChatMessages((prev) => {
      const msgs = [...(prev[pid] || [])];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && !last.content) {
        last.content = '(无响应)';
      }
      return { ...prev, [pid]: msgs };
    });

    // Persist LLM history for next message (runAgentLoop appends to the array)
    chatHistoriesRef.current[pid] = llmMessages;

    // Save assistant message to DB
    if (lastContent) {
      saveProjectChatMsg(pid, { role: 'assistant', content: lastContent, toolCalls: allToolLabels });
    }

    chatAbortRef.current = null;
    setChatLoading(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [chatInput, selectedProject, chatMessages]);

  // ── Stop running chat ──
  const handleChatStop = useCallback(() => {
    chatAbortRef.current?.abort();
  }, []);

  // ── Filter ──
  const filteredProjects = projects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (p.local_path || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isGenerated = selectedProject?.source_type !== 'imported';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500 transition-colors"
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>
          <h1 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">
            {t('projects.title')}
          </h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
            {projects.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setIsImporting(true); setIsCreating(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-green-500 hover:bg-green-600 text-white transition-colors"
          >
            <Import size={14} />
            {t('projects.import')}
          </button>
          <button
            onClick={() => { setIsCreating(true); setIsImporting(false); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
          >
            <Plus size={14} />
            {t('projects.newProject')}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar - Project List */}
        {sidebarOpen && (
        <div className="w-72 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0">
          {/* Search */}
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search projects..."
                className="w-full pl-9 pr-3 py-2 text-[12px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>
          </div>

          {/* New Project Form */}
          {isCreating && (
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder={t('projects.projectName') + '...'}
                className="w-full px-3 py-2 text-[12px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateProject();
                  if (e.key === 'Escape') { setIsCreating(false); setNewProjectName(''); }
                }}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleCreateProject}
                  className="flex-1 px-3 py-1.5 text-[11px] font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => { setIsCreating(false); setNewProjectName(''); }}
                  className="flex-1 px-3 py-1.5 text-[11px] font-medium bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Import Folder Form */}
          {isImporting && (
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
              <p className="text-[11px] text-zinc-500 mb-2">{t('projects.importDesc')}</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={importPath}
                  onChange={(e) => { setImportPath(e.target.value); setImportError(null); }}
                  placeholder={t('projects.folderPath') + ' (e.g. D:\\my-project)'}
                  className="flex-1 px-3 py-2 text-[12px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-mono"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleImportFolder();
                    if (e.key === 'Escape') { setIsImporting(false); setImportPath(''); setImportError(null); }
                  }}
                />
                <button
                  onClick={selectFolderDialog}
                  className="px-3 py-2 text-[11px] font-medium bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded-lg transition-colors whitespace-nowrap"
                  title="Browse folders"
                >
                  <FolderOpen size={14} />
                </button>
              </div>
              {importError && (
                <p className="text-[11px] text-red-500 mt-1">{importError}</p>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleImportFolder}
                  disabled={!importPath.trim()}
                  className={`flex-1 px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
                    importPath.trim()
                      ? 'bg-green-500 hover:bg-green-600 text-white'
                      : 'bg-zinc-300 dark:bg-zinc-600 text-zinc-500 cursor-not-allowed'
                  }`}
                >
                  {t('projects.importConfirm')}
                </button>
                <button
                  onClick={() => { setIsImporting(false); setImportPath(''); setImportError(null); }}
                  className="flex-1 px-3 py-1.5 text-[11px] font-medium bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Project List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-zinc-400">
                <RefreshCw size={16} className="animate-spin mr-2" />
                Loading...
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-zinc-400">
                <FolderOpen size={32} className="mb-2 opacity-30" />
                <p className="text-[12px]">
                  {searchQuery ? 'No matching projects' : t('projects.noProjects')}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => setIsCreating(true)}
                    className="mt-2 text-[11px] text-blue-500 hover:text-blue-600"
                  >
                    {t('projects.createFirst')}
                  </button>
                )}
              </div>
            ) : (
              filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isSelected={selectedProject?.id === project.id}
                  isActive={activeProject?.id === project.id}
                  onSelect={() => handleSelectProject(project)}
                  onDelete={() => handleDeleteProject(project.id)}
                />
              ))
            )}
          </div>
        </div>
        )}

        {/* Right Content */}
        <div className="flex-1 flex flex-col min-h-0">
          {selectedProject ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                <div className="flex items-center gap-3">
                  <h2 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
                    {selectedProject.name}
                  </h2>
                  {!isGenerated && selectedProject.local_path && (
                    <span className="text-[10px] text-zinc-400 font-mono truncate max-w-[300px]">
                      {selectedProject.local_path}
                    </span>
                  )}
                  {saveMessage && (
                    <span className={`text-[11px] px-2 py-0.5 rounded ${
                      saveMessage.type === 'ok'
                        ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400'
                        : 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400'
                    }`}>
                      {saveMessage.text}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isGenerated && (
                    <>
                      <button
                        onClick={() => setEditMode(!editMode)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                          editMode
                            ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                            : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                        }`}
                      >
                        <Code size={12} />
                        {editMode ? 'Editing' : 'Edit'}
                      </button>
                      {editMode && (
                        <button
                          onClick={handleSaveCode}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-green-500 hover:bg-green-600 text-white transition-colors"
                        >
                          <Save size={12} />
                          Save
                        </button>
                      )}
                      <button
                        onClick={handleRefreshPreview}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-zinc-600 dark:text-zinc-400 transition-colors"
                      >
                        <RefreshCw size={12} />
                        Refresh
                      </button>
                      <button
                        onClick={() => setShowConsole(!showConsole)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                          showConsole
                            ? 'bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400'
                            : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                        }`}
                      >
                        {showConsole ? <EyeOff size={12} /> : <Eye size={12} />}
                        Console
                      </button>
                    </>
                  )}
                  {!isGenerated && editMode && (
                    <button
                      onClick={handleSaveCode}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-green-500 hover:bg-green-600 text-white transition-colors"
                    >
                      <Save size={12} />
                      Save to Disk
                    </button>
                  )}
                </div>
              </div>

              {/* Content Area */}
              <div className="flex-1 flex min-h-0">
                {isGenerated ? (
                  <>
                    {/* Generated: Editor + Preview */}
                    {editMode && (
                      <div className="w-1/2 border-r border-zinc-200 dark:border-zinc-800">
                        <CodeEditor
                          code={editedCode}
                          onChange={setEditedCode}
                          language="html"
                        />
                      </div>
                    )}
                    <div className={`flex flex-col ${editMode ? 'w-1/2' : 'w-full'}`}>
                      <div className="flex-1 min-h-0">
                        {preview.projectId === selectedProject.id && preview.isolatedDocument ? (
                          <HTMLPreview
                            htmlContent={preview.htmlContent}
                            isolatedDocument={preview.isolatedDocument}
                            onConsoleLog={setConsoleLogs}
                          />
                        ) : (
                          <div className="flex items-center justify-center h-full text-zinc-400">
                            <div className="text-center">
                              <Play size={32} className="mx-auto mb-2 opacity-30" />
                              <p className="text-[12px]">Click Refresh to preview</p>
                            </div>
                          </div>
                        )}
                      </div>
                      {showConsole && (
                        <div className="h-48 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-900 text-zinc-100 overflow-auto">
                          <div className="sticky top-0 flex items-center justify-between px-3 py-1.5 bg-zinc-800 border-b border-zinc-700">
                            <span className="text-[11px] font-medium text-zinc-400">Console</span>
                            <button onClick={() => setConsoleLogs([])} className="text-[10px] text-zinc-500 hover:text-zinc-300">Clear</button>
                          </div>
                          <div className="p-3 font-mono text-[11px] space-y-1">
                            {consoleLogs.length === 0 ? (
                              <p className="text-zinc-500">No console output</p>
                            ) : (
                              consoleLogs.map((log, i) => (
                                <div key={i} className={`${
                                  log.startsWith('[ERROR]') ? 'text-red-400' : log.startsWith('[WARN]') ? 'text-yellow-400' : log.startsWith('[INFO]') ? 'text-blue-400' : 'text-zinc-300'
                                }`}>{log}</div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Imported: File Explorer + Editor */}
                    {selectedProject.local_path && (
                      <div className="w-56 shrink-0">
                        <DiskFileExplorer
                          localPath={selectedProject.local_path}
                          activeFilePath={activeFileRelPath}
                          onFileSelect={(diskPath) => handleOpenFile(diskPath, diskPath.split(/[\\/]/).pop() || diskPath)}
                        />
                      </div>
                    )}
                    <div className="flex-1 min-h-0">
                      {activeFileRelPath ? (
                        <CodeEditor
                          code={editedCode}
                          onChange={setEditedCode}
                          language={activeFileRelPath.split('.').pop() || 'text'}
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-zinc-400">
                          <FolderOpen size={48} className="mb-3 opacity-30" />
                          <p className="text-[13px] font-medium text-zinc-500 mb-1">
                            {selectedProject.name}
                          </p>
                          <p className="text-[12px] text-zinc-400">
                            Select a file from the explorer to edit
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            /* Empty State */
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
              <FolderOpen size={56} className="mb-4 opacity-30" />
              <h2 className="text-lg font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
                {t('projects.title')}
              </h2>
              <p className="text-[13px] text-center max-w-xs">
                Select a project from the list, import a folder, or create a new one.
              </p>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setIsImporting(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium bg-green-500 hover:bg-green-600 text-white transition-colors"
                >
                  <Import size={14} />
                  {t('projects.import')}
                </button>
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                >
                  <Plus size={14} />
                  {t('projects.newProject')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Chat Panel ── */}
        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
          {selectedProject ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-100 dark:border-zinc-800">
                <Bot size={14} className="text-blue-500" />
                <span className="text-[11px] font-medium text-zinc-500">
                  Chat · {selectedProject.name}
                </span>
                {chatLoading && (
                  <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                    <LoaderCircle size={10} className="animate-spin" />
                    Thinking...
                  </span>
                )}
              </div>

              {/* Messages */}
              <div className="max-h-[200px] overflow-y-auto px-4 py-2 space-y-2">
                {(chatMessages[selectedProject.id] || []).length === 0 && !chatLoading && (
                  <p className="text-[11px] text-zinc-400 text-center py-4">
                    在这里与 code agent 对话，操作当前项目
                  </p>
                )}
                {(chatMessages[selectedProject.id] || []).map((msg, i) => (
                  <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                    {msg.role === 'assistant' && (
                      <Bot size={14} className="text-blue-500 shrink-0 mt-0.5" />
                    )}
                    <div className={`max-w-[80%] rounded-lg px-3 py-1.5 text-[12px] ${
                      msg.role === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                    }`}>
                      {/* Tool calls */}
                      {msg.toolCalls.length > 0 && (
                        <div className="mb-1 space-y-0.5">
                          {msg.toolCalls.map((tc, j) => (
                            <div key={j} className="flex items-center gap-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                              <Wrench size={10} />
                              <span className="truncate">{tc}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Content */}
                      {msg.content && (
                        <div className="whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                      )}
                    </div>
                    {msg.role === 'user' && (
                      <User size={14} className="text-zinc-400 shrink-0 mt-0.5" />
                    )}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div className="flex items-center gap-2 px-4 py-2 border-t border-zinc-100 dark:border-zinc-800">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleChatSend();
                    }
                  }}
                  placeholder={chatLoading ? 'Waiting...' : `Tell code agent about ${selectedProject.name}...`}
                  disabled={chatLoading}
                  className="flex-1 px-3 py-1.5 text-[12px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50"
                />
                {chatLoading ? (
                  <button
                    onClick={handleChatStop}
                    className="p-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors"
                    title="Stop"
                  >
                    <Square size={14} />
                  </button>
                ) : (
                  <button
                    onClick={handleChatSend}
                    disabled={!chatInput.trim()}
                    className="p-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send size={14} />
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="px-4 py-3 text-center">
              <p className="text-[11px] text-zinc-400">
                选择一个项目，开始与 code agent 协作
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

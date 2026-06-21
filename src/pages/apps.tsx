import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AppWindow, Play, Code, Trash2, RefreshCw, Eye, EyeOff,
  Save, Plus, Search, Folder, File, ChevronRight, ChevronDown,
} from 'lucide-react';
import { useT } from '@/i18n/strings';
import { getDB } from '@/db';
import { codeSandboxService } from '@/services/code-sandbox';
import { appEvents, APP_EVENTS } from '@/services/app-events';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SavedApp {
  id: string;
  name: string;
  code: string;
  created_at: string;
  description?: string;
  project_type?: string;
  files_json?: string;
  entry_file?: string;
}

interface PreviewState {
  appId: string | null;
  htmlContent: string;
  isolatedDocument: string;
  isFullscreen: boolean;
}

interface ProjectFiles {
  [path: string]: string;
}

// ---------------------------------------------------------------------------
// File Explorer Component
// ---------------------------------------------------------------------------

function FileExplorer({
  files,
  activeFile,
  onFileSelect,
}: {
  files: ProjectFiles;
  activeFile: string;
  onFileSelect: (path: string) => void;
}) {
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['.']));

  // Build file tree structure
  const fileTree = useCallback(() => {
    const tree: { name: string; path: string; isDir: boolean; children?: typeof tree }[] = [];
    const dirMap = new Map<string, typeof tree>();

    const paths = Object.keys(files).sort();
    for (const path of paths) {
      const parts = path.split('/');
      let currentLevel = tree;
      let currentPath = '';

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLast = i === parts.length - 1;

        if (isLast) {
          // File
          currentLevel.push({
            name: part,
            path: path,
            isDir: false,
          });
        } else {
          // Directory
          let dir = currentLevel.find((item) => item.name === part && item.isDir);
          if (!dir) {
            dir = {
              name: part,
              path: currentPath,
              isDir: true,
              children: [],
            };
            currentLevel.push(dir);
            dirMap.set(currentPath, dir.children!);
          }
          currentLevel = dir.children!;
        }
      }
    }

    return tree;
  }, [files]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const renderTree = (items: ReturnType<typeof fileTree>, depth = 0) => {
    return items.map((item) => (
      <div key={item.path}>
        <button
          onClick={() => {
            if (item.isDir) {
              toggleDir(item.path);
            } else {
              onFileSelect(item.path);
            }
          }}
          className={`w-full flex items-center gap-1.5 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
            activeFile === item.path ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : ''
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {item.isDir ? (
            <>
              {expandedDirs.has(item.path) ? (
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
          <span className="truncate">{item.name}</span>
        </button>
        {item.isDir && item.children && expandedDirs.has(item.path) && (
          renderTree(item.children, depth + 1)
        )}
      </div>
    ));
  };

  const tree = fileTree();

  return (
    <div className="h-full overflow-y-auto bg-zinc-50 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800">
      <div className="px-3 py-2 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
        Files
      </div>
      {renderTree(tree)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HTML Preview Component
// ---------------------------------------------------------------------------

function HTMLPreview({
  htmlContent,
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

    // Write the isolated document to the iframe
    iframe.srcdoc = isolatedDocument;

    // Listen for messages from iframe (console logs, errors)
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
// Code Editor Component
// ---------------------------------------------------------------------------

function CodeEditor({
  code,
  onChange,
  language = 'html',
}: {
  code: string;
  onChange: (code: string) => void;
  language?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Tab key for indentation
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = code.substring(0, start) + '  ' + code.substring(end);
      onChange(newValue);

      // Restore cursor position
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-zinc-800 dark:bg-zinc-700 rounded text-[10px] text-zinc-400">
        <Code size={10} />
        {language.toUpperCase()}
      </div>
      <textarea
        ref={textareaRef}
        value={code}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full h-full p-4 font-mono text-[13px] leading-relaxed bg-zinc-900 text-zinc-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        spellCheck={false}
        placeholder="Enter HTML code here..."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App Card Component
// ---------------------------------------------------------------------------

function AppCard({
  app,
  isSelected,
  onSelect,
  onDelete,
}: {
  app: SavedApp;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const createdDate = new Date(app.created_at).toLocaleDateString();
  const isMultiFile = app.project_type === 'multi';

  return (
    <div
      onClick={onSelect}
      className={`group relative p-3 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-sm'
          : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg ${isSelected ? 'bg-blue-100 dark:bg-blue-800' : 'bg-zinc-100 dark:bg-zinc-800'}`}>
          {isMultiFile ? (
            <Folder size={16} className={isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-yellow-500'} />
          ) : (
            <AppWindow size={16} className={isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-500'} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-semibold text-zinc-900 dark:text-zinc-100 truncate">
              {app.name}
            </h3>
            {isMultiFile && (
              <span className="px-1.5 py-0.5 rounded text-[9px] bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400">
                Project
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
            {createdDate}
          </p>
          {app.description && (
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1 line-clamp-2">
              {app.description}
            </p>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-zinc-400 hover:text-red-500 transition-all"
          title="Delete app"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Apps Page
// ---------------------------------------------------------------------------

export default function AppsPage() {
  const t = useT();
  const [apps, setApps] = useState<SavedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedApp, setSelectedApp] = useState<SavedApp | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editedCode, setEditedCode] = useState('');
  const [preview, setPreview] = useState<PreviewState>({
    appId: null,
    htmlContent: '',
    isolatedDocument: '',
    isFullscreen: false,
  });
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [projectFiles, setProjectFiles] = useState<ProjectFiles>({});
  const [activeFile, setActiveFile] = useState('');
  const [showFileExplorer, setShowFileExplorer] = useState(false);

  // Load apps from database
  const loadApps = useCallback(async () => {
    setLoading(true);
    try {
      const db = await getDB();
      const rows = await db.query<SavedApp>(
        'SELECT id, name, code, description, project_type, files_json, entry_file, created_at FROM savedApps ORDER BY created_at DESC'
      );
      setApps(rows);
    } catch (err) {
      console.error('Failed to load apps:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  // Parse project files for multi-file projects
  const parseProjectFiles = useCallback((app: SavedApp): ProjectFiles => {
    if (app.project_type === 'multi' && app.files_json) {
      try {
        const files = JSON.parse(app.files_json);
        // If files is an array of paths, we need to load content
        if (Array.isArray(files)) {
          // Convert array to object with placeholder content
          const result: ProjectFiles = {};
          for (const path of files) {
            result[path] = `// File: ${path}\n// Content will be loaded from file system`;
          }
          return result;
        }
        return files;
      } catch {
        return {};
      }
    }
    return {};
  }, []);

  // Process HTML for preview
  const processForPreview = useCallback(async (app: SavedApp) => {
    try {
      let htmlContent = app.code;

      // For multi-file projects, use the entry file or construct HTML
      if (app.project_type === 'multi') {
        const files = parseProjectFiles(app);
        setProjectFiles(files);

        // Find entry file or use first HTML file
        const entryFile = app.entry_file || Object.keys(files).find(f => f.endsWith('.html')) || Object.keys(files)[0];
        setActiveFile(entryFile);

        if (entryFile && files[entryFile]) {
          htmlContent = files[entryFile];
        } else {
          // Construct a simple HTML page that lists the project files
          htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${app.name}</title>
  <style>
    body { font-family: system-ui; padding: 2rem; }
    .file-list { list-style: none; padding: 0; }
    .file-item { padding: 0.5rem; margin: 0.5rem 0; background: #f5f5f5; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${app.name}</h1>
  <p>Multi-file project with ${Object.keys(files).length} files</p>
  <ul class="file-list">
    ${Object.keys(files).map(f => `<li class="file-item">${f}</li>`).join('\n    ')}
  </ul>
</body>
</html>`;
        }
      }

      const result = await codeSandboxService.execute('html', htmlContent, undefined, {
        allowExternalResources: true,
      });

      if (result.success && result.isolatedDocument) {
        setPreview({
          appId: app.id,
          htmlContent: result.htmlContent || htmlContent,
          isolatedDocument: result.isolatedDocument,
          isFullscreen: false,
        });
        setConsoleLogs([]);
      }
    } catch (err) {
      console.error('Failed to process HTML:', err);
    }
  }, [parseProjectFiles]);

  // Listen for real-time app updates from code generation
  useEffect(() => {
    const handleAppCreated = (event: unknown) => {
      const { id, name, code, created_at } = event as {
        id: string;
        name: string;
        code: string;
        created_at: string;
      };

      // Add new app to the list
      const newApp: SavedApp = { id, name, code, created_at };
      setApps((prev) => [newApp, ...prev]);

      // Auto-select and preview the new app
      setSelectedApp(newApp);
      setEditedCode(code);
      processForPreview(newApp);
    };

    const handleHTMLGenerated = (event: unknown) => {
      const { appId } = event as {
        appId: string;
        name: string;
        code: string;
      };

      // Reload apps to get the latest
      loadApps();

      // Find and select the new app
      setTimeout(async () => {
        try {
          const db = await getDB();
          const rows = await db.query<SavedApp>(
            'SELECT id, name, code, created_at FROM savedApps WHERE id = ?',
            [appId]
          );
          if (rows.length > 0) {
            setSelectedApp(rows[0]);
            setEditedCode(rows[0].code);
            await processForPreview(rows[0]);
          }
        } catch (err) {
          console.error('Failed to load new app:', err);
        }
      }, 100);
    };

    const unsubCreated = appEvents.on(APP_EVENTS.APP_CREATED, handleAppCreated);
    const unsubHTML = appEvents.on(APP_EVENTS.HTML_GENERATED, handleHTMLGenerated);

    return () => {
      unsubCreated();
      unsubHTML();
    };
  }, [loadApps, processForPreview]);

  // Select and preview an app
  const handleSelectApp = useCallback(async (app: SavedApp) => {
    setSelectedApp(app);
    setEditedCode(app.code);
    setEditMode(false);
    await processForPreview(app);
  }, [processForPreview]);

  // Refresh preview
  const handleRefreshPreview = useCallback(async () => {
    if (selectedApp) {
      await processForPreview(selectedApp);
    }
  }, [selectedApp, processForPreview]);

  // Save edited code
  const handleSaveCode = useCallback(async () => {
    if (!selectedApp) return;

    try {
      const db = await getDB();
      await db.execute(
        'UPDATE savedApps SET code = ? WHERE id = ?',
        [editedCode, selectedApp.id]
      );

      const updatedApp = { ...selectedApp, code: editedCode };
      setSelectedApp(updatedApp);
      setApps((prev) =>
        prev.map((a) => (a.id === updatedApp.id ? updatedApp : a))
      );

      // Refresh preview with new code
      await processForPreview(updatedApp);

      setSaveMessage({ type: 'ok', text: 'Code saved successfully' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'err', text: `Failed to save: ${err}` });
      setTimeout(() => setSaveMessage(null), 3000);
    }
  }, [selectedApp, editedCode, processForPreview]);

  // Delete an app
  const handleDeleteApp = useCallback(async (appId: string) => {
    if (!confirm('Are you sure you want to delete this app?')) return;

    try {
      const db = await getDB();
      await db.execute('DELETE FROM savedApps WHERE id = ?', [appId]);

      setApps((prev) => prev.filter((a) => a.id !== appId));

      if (selectedApp?.id === appId) {
        setSelectedApp(null);
        setPreview({ appId: null, htmlContent: '', isolatedDocument: '', isFullscreen: false });
      }

      setSaveMessage({ type: 'ok', text: 'App deleted' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'err', text: `Failed to delete: ${err}` });
      setTimeout(() => setSaveMessage(null), 3000);
    }
  }, [selectedApp]);

  // Create new app
  const handleCreateApp = useCallback(async () => {
    if (!newAppName.trim()) return;

    const defaultCode = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${newAppName}</title>
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
  <h1>Welcome to ${newAppName}</h1>
  <p>This is your new app. Start editing to customize it!</p>
  <div class="card">
    <h2>Getting Started</h2>
    <p>Edit the HTML, CSS, and JavaScript to build your app.</p>
  </div>
</body>
</html>`;

    try {
      const db = await getDB();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        'INSERT INTO savedApps (id, name, code, created_at) VALUES (?, ?, ?, ?)',
        [id, newAppName.trim(), defaultCode, now]
      );

      const newApp: SavedApp = {
        id,
        name: newAppName.trim(),
        code: defaultCode,
        created_at: now,
      };

      setApps((prev) => [newApp, ...prev]);
      setSelectedApp(newApp);
      setEditedCode(defaultCode);
      setIsCreating(false);
      setNewAppName('');
      await processForPreview(newApp);

      setSaveMessage({ type: 'ok', text: 'App created successfully' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      setSaveMessage({ type: 'err', text: `Failed to create app: ${err}` });
      setTimeout(() => setSaveMessage(null), 3000);
    }
  }, [newAppName, processForPreview]);

  // Filter apps by search query
  const filteredApps = apps.filter((app) =>
    app.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-[16px] font-bold text-zinc-900 dark:text-zinc-100">
            {t('nav.apps')}
          </h1>
          <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500">
            {apps.length} apps
          </span>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
        >
          <Plus size={14} />
          New App
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar - App List */}
        <div className="w-72 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0">
          {/* Search */}
          <div className="p-3 border-b border-zinc-200 dark:border-zinc-800">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search apps..."
                className="w-full pl-9 pr-3 py-2 text-[12px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>
          </div>

          {/* New App Form */}
          {isCreating && (
            <div className="p-3 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
              <input
                type="text"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                placeholder="App name..."
                className="w-full px-3 py-2 text-[12px] bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateApp();
                  if (e.key === 'Escape') {
                    setIsCreating(false);
                    setNewAppName('');
                  }
                }}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleCreateApp}
                  className="flex-1 px-3 py-1.5 text-[11px] font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setIsCreating(false);
                    setNewAppName('');
                  }}
                  className="flex-1 px-3 py-1.5 text-[11px] font-medium bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* App List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-zinc-400">
                <RefreshCw size={16} className="animate-spin mr-2" />
                Loading...
              </div>
            ) : filteredApps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-zinc-400">
                <AppWindow size={32} className="mb-2 opacity-30" />
                <p className="text-[12px]">
                  {searchQuery ? 'No matching apps' : 'No apps yet'}
                </p>
                {!searchQuery && (
                  <button
                    onClick={() => setIsCreating(true)}
                    className="mt-2 text-[11px] text-blue-500 hover:text-blue-600"
                  >
                    Create your first app
                  </button>
                )}
              </div>
            ) : (
              filteredApps.map((app) => (
                <AppCard
                  key={app.id}
                  app={app}
                  isSelected={selectedApp?.id === app.id}
                  onSelect={() => handleSelectApp(app)}
                  onDelete={() => handleDeleteApp(app.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right Content - Editor & Preview */}
        <div className="flex-1 flex flex-col min-h-0">
          {selectedApp ? (
            <>
              {/* Toolbar */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                <div className="flex items-center gap-3">
                  <h2 className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-300">
                    {selectedApp.name}
                  </h2>
                  {saveMessage && (
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded ${
                        saveMessage.type === 'ok'
                          ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400'
                      }`}
                    >
                      {saveMessage.text}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedApp.project_type === 'multi' && (
                    <button
                      onClick={() => setShowFileExplorer(!showFileExplorer)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                        showFileExplorer
                          ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-400'
                          : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                      }`}
                    >
                      <Folder size={12} />
                      Files
                    </button>
                  )}
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
                </div>
              </div>

              {/* Editor & Preview Area */}
              <div className="flex-1 flex min-h-0">
                {/* File Explorer (shown for multi-file projects) */}
                {showFileExplorer && selectedApp.project_type === 'multi' && Object.keys(projectFiles).length > 0 && (
                  <div className="w-48 shrink-0">
                    <FileExplorer
                      files={projectFiles}
                      activeFile={activeFile}
                      onFileSelect={(path) => {
                        setActiveFile(path);
                        if (projectFiles[path]) {
                          setEditedCode(projectFiles[path]);
                        }
                      }}
                    />
                  </div>
                )}

                {/* Code Editor (shown in edit mode) */}
                {editMode && (
                  <div className="w-1/2 border-r border-zinc-200 dark:border-zinc-800">
                    <CodeEditor
                      code={editedCode}
                      onChange={setEditedCode}
                      language="html"
                    />
                  </div>
                )}

                {/* Preview */}
                <div className={`flex flex-col ${editMode ? 'w-1/2' : 'w-full'}`}>
                  <div className="flex-1 min-h-0">
                    {preview.appId === selectedApp.id && preview.isolatedDocument ? (
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

                  {/* Console Output */}
                  {showConsole && (
                    <div className="h-48 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-900 text-zinc-100 overflow-auto">
                      <div className="sticky top-0 flex items-center justify-between px-3 py-1.5 bg-zinc-800 border-b border-zinc-700">
                        <span className="text-[11px] font-medium text-zinc-400">Console</span>
                        <button
                          onClick={() => setConsoleLogs([])}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="p-3 font-mono text-[11px] space-y-1">
                        {consoleLogs.length === 0 ? (
                          <p className="text-zinc-500">No console output</p>
                        ) : (
                          consoleLogs.map((log, i) => (
                            <div
                              key={i}
                              className={`${
                                log.startsWith('[ERROR]')
                                  ? 'text-red-400'
                                  : log.startsWith('[WARN]')
                                  ? 'text-yellow-400'
                                  : log.startsWith('[INFO]')
                                  ? 'text-blue-400'
                                  : 'text-zinc-300'
                              }`}
                            >
                              {log}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* Empty State */
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 dark:text-zinc-500">
              <AppWindow size={56} className="mb-4 opacity-30" />
              <h2 className="text-lg font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
                App Preview Studio
              </h2>
              <p className="text-[13px] text-center max-w-xs">
                Select an app from the list or create a new one to preview and edit.
              </p>
              <button
                onClick={() => setIsCreating(true)}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
              >
                <Plus size={14} />
                Create New App
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

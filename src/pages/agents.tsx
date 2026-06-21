import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitBranch, ChevronDown, ChevronRight, Trash2, RefreshCw,
  CheckCircle, XCircle, Clock, Loader2, FileCode, MessageSquare,
  ClipboardList, Code2, Eye, Hash, ArrowRight,
} from 'lucide-react';
import {
  getAllTaskTreeProjects,
  getTaskTreeByProject,
  getAgentProcessLogsByTask,
  getAgentMessagesByTask,
  deleteTaskTreeProject,
} from '@/services/cache-service';
import type { TaskTreeRow, AgentProcessLogRow, AgentMessageRow } from '@/db/types';

// ── Helpers ──

function formatDateTime(dt: string | null): string {
  if (!dt) return '-';
  try {
    const d = new Date(dt.replace(' ', 'T') + (dt.includes('Z') || dt.includes('+') ? '' : 'Z'));
    return d.toLocaleString();
  } catch {
    return dt;
  }
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusConfig(status: string): { color: string; bg: string; icon: React.ReactNode; label: string } {
  switch (status) {
    case 'done':
      return { color: 'text-green-700 dark:text-green-300', bg: 'bg-green-100 dark:bg-green-900/40', icon: <CheckCircle size={12} />, label: 'Done' };
    case 'failed':
      return { color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/40', icon: <XCircle size={12} />, label: 'Failed' };
    case 'analyzing':
      return { color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-100 dark:bg-blue-900/40', icon: <Loader2 size={12} className="animate-spin" />, label: 'Analyzing' };
    case 'coding':
      return { color: 'text-purple-700 dark:text-purple-300', bg: 'bg-purple-100 dark:bg-purple-900/40', icon: <Code2 size={12} />, label: 'Coding' };
    case 'reviewing':
      return { color: 'text-yellow-700 dark:text-yellow-300', bg: 'bg-yellow-100 dark:bg-yellow-900/40', icon: <Eye size={12} />, label: 'Reviewing' };
    case 'pending':
      return { color: 'text-zinc-500 dark:text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800', icon: <Clock size={12} />, label: 'Pending' };
    default:
      return { color: 'text-zinc-500 dark:text-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800', icon: <Clock size={12} />, label: status };
  }
}

function agentTypeConfig(type: string): { color: string; label: string } {
  switch (type) {
    case 'orchestrator': return { color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', label: 'Orchestrator' };
    case 'architect': return { color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300', label: 'Architect' };
    case 'developer': return { color: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300', label: 'Developer' };
    case 'reviewer': return { color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300', label: 'Reviewer' };
    case 'integrator': return { color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300', label: 'Integrator' };
    default: return { color: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300', label: type };
  }
}

function actionIcon(action: string): React.ReactNode {
  switch (action) {
    case 'analyze': return <Eye size={14} className="text-blue-500" />;
    case 'decide_split': return <GitBranch size={14} className="text-indigo-500" />;
    case 'code': return <Code2 size={14} className="text-green-500" />;
    case 'write_file': return <FileCode size={14} className="text-green-500" />;
    case 'read_file': return <FileCode size={14} className="text-zinc-500" />;
    case 'review': return <Eye size={14} className="text-yellow-500" />;
    case 'fix': return <RefreshCw size={14} className="text-orange-500" />;
    case 'negotiate': return <MessageSquare size={14} className="text-purple-500" />;
    case 'shell_exec': return <Code2 size={14} className="text-cyan-500" />;
    case 'done': return <CheckCircle size={14} className="text-green-500" />;
    default: return <Hash size={14} className="text-zinc-400" />;
  }
}

// ── TaskTreeNode ──

function TaskTreeNode({
  task,
  allTasks,
  selectedId,
  onSelect,
  depth = 0,
}: {
  task: TaskTreeRow;
  allTasks: TaskTreeRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const children = allTasks.filter(t => t.parent_module_id === task.id);
  const hasChildren = children.length > 0;
  const sc = statusConfig(task.status);
  const ac = agentTypeConfig(task.agent_type);
  const isSelected = selectedId === task.id;

  return (
    <div>
      <div
        className={`flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-colors text-[13px] ${
          isSelected
            ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700'
            : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border border-transparent'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(task.id)}
      >
        {/* Expand toggle */}
        <span
          className={`w-4 h-4 flex items-center justify-center shrink-0 ${hasChildren ? 'cursor-pointer' : 'invisible'}`}
          onClick={(e) => { if (hasChildren) { e.stopPropagation(); setExpanded(!expanded); } }}
        >
          {hasChildren && (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
        </span>

        {/* Module name */}
        <span className="font-medium text-zinc-800 dark:text-zinc-200 truncate flex-1 min-w-0">
          {task.module_name}
        </span>

        {/* Agent type badge */}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${ac.color}`}>
          {ac.label}
        </span>

        {/* Status badge */}
        <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${sc.bg} ${sc.color}`}>
          {sc.icon}
          {sc.label}
        </span>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div>
          {children.map(child => (
            <TaskTreeNode
              key={child.id}
              task={child}
              allTasks={allTasks}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── TaskDetailPanel ──

function TaskDetailPanel({ task }: { task: TaskTreeRow }) {
  const [tab, setTab] = useState<'logs' | 'messages' | 'raw'>('logs');
  const [logs, setLogs] = useState<AgentProcessLogRow[]>([]);
  const [messages, setMessages] = useState<AgentMessageRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [l, m] = await Promise.all([
          getAgentProcessLogsByTask(task.id),
          getAgentMessagesByTask(task.id),
        ]);
        if (!cancelled) {
          setLogs(l);
          setMessages(m);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [task.id]);

  const sc = statusConfig(task.status);
  const ac = agentTypeConfig(task.agent_type);

  const outputFiles: string[] = (() => {
    try { return task.output_files_json ? JSON.parse(task.output_files_json) : []; } catch { return []; }
  })();

  const decision: Record<string, unknown> | null = (() => {
    try { return task.decision_json ? JSON.parse(task.decision_json) : null; } catch { return null; }
  })();

  const contract: Record<string, unknown> | null = (() => {
    try { return task.contract_json ? JSON.parse(task.contract_json) : null; } catch { return null; }
  })();

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{task.module_name}</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ac.color}`}>{ac.label}</span>
          <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${sc.bg} ${sc.color}`}>
            {sc.icon}
            {sc.label}
          </span>
        </div>
        <div className="text-[12px] text-zinc-400 dark:text-zinc-500 font-mono truncate">{task.module_path}</div>
        <div className="flex items-center gap-4 mt-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
          <span>Depth: {task.depth}</span>
          <span>Agent: <code className="font-mono">{task.agent_id ?? '-'}</code></span>
          <span>Updated: {formatDateTime(task.updated_at)}</span>
        </div>
        {task.error_info && (
          <div className="mt-2 p-2 rounded bg-red-50 dark:bg-red-900/20 text-[12px] text-red-700 dark:text-red-300">
            {task.error_info}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        {([['logs', 'Execution Logs', ClipboardList], ['messages', 'Messages', MessageSquare], ['raw', 'Raw Data', Code2]] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
              tab === key
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
            }`}
          >
            <Icon size={14} />
            {label}
            {key === 'logs' && logs.length > 0 && (
              <span className="ml-1 px-1 rounded-full bg-blue-100 dark:bg-blue-800 text-[10px]">{logs.length}</span>
            )}
            {key === 'messages' && messages.length > 0 && (
              <span className="ml-1 px-1 rounded-full bg-blue-100 dark:bg-blue-800 text-[10px]">{messages.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4">
        {loading && (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading...
          </div>
        )}

        {/* ── Logs Tab ── */}
        {tab === 'logs' && !loading && (
          logs.length === 0 ? (
            <EmptyState icon={<ClipboardList size={32} />} text="No execution logs" />
          ) : (
            <div className="space-y-1">
              {logs.map((log, i) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 py-2 px-3 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
                >
                  {/* Step number */}
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono text-zinc-500 shrink-0 mt-0.5">
                    {log.step_order}
                  </div>

                  {/* Action icon */}
                  <div className="mt-0.5 shrink-0">
                    {actionIcon(log.action)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">{log.action}</span>
                      {log.agent_id && (
                        <code className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">{log.agent_id}</code>
                      )}
                      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 ml-auto shrink-0">
                        {formatDuration(log.duration_ms)}
                      </span>
                    </div>
                    {log.input_summary && (
                      <div className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
                        <span className="text-zinc-400 dark:text-zinc-500">in:</span> {log.input_summary}
                      </div>
                    )}
                    {log.output_summary && (
                      <div className="text-[12px] text-zinc-600 dark:text-zinc-300 mt-0.5 truncate">
                        <span className="text-zinc-400 dark:text-zinc-500">out:</span> {log.output_summary}
                      </div>
                    )}
                    {log.file_path && (
                      <div className="text-[11px] text-blue-500 dark:text-blue-400 mt-0.5 font-mono truncate">
                        📄 {log.file_path}
                      </div>
                    )}
                    {log.decision_rationale && (
                      <div className="text-[12px] text-indigo-600 dark:text-indigo-400 mt-1 p-2 rounded bg-indigo-50 dark:bg-indigo-900/20 whitespace-pre-wrap">
                        {log.decision_rationale}
                      </div>
                    )}
                    {log.error_info && (
                      <div className="text-[12px] text-red-600 dark:text-red-400 mt-1 p-2 rounded bg-red-50 dark:bg-red-900/20">
                        {log.error_info}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {/* ── Messages Tab ── */}
        {tab === 'messages' && !loading && (
          messages.length === 0 ? (
            <EmptyState icon={<MessageSquare size={32} />} text="No agent messages" />
          ) : (
            <div className="space-y-2">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <code className="text-[11px] font-mono text-blue-600 dark:text-blue-400">{msg.from_agent_id}</code>
                    <ArrowRight size={12} className="text-zinc-400" />
                    <code className="text-[11px] font-mono text-green-600 dark:text-green-400">{msg.to_agent_id}</code>
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                      {msg.message_type}
                    </span>
                    {msg.resolved ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">resolved</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300">open</span>
                    )}
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 ml-auto">{formatDateTime(msg.created_at)}</span>
                  </div>
                  <div className="text-[13px] font-medium text-zinc-800 dark:text-zinc-200">{msg.subject}</div>
                  <div className="text-[12px] text-zinc-600 dark:text-zinc-400 mt-1 whitespace-pre-wrap">{msg.content}</div>
                  {msg.resolution && (
                    <div className="mt-2 p-2 rounded bg-green-50 dark:bg-green-900/20 text-[12px] text-green-700 dark:text-green-300">
                      <span className="font-medium">Resolution:</span> {msg.resolution}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {/* ── Raw Data Tab ── */}
        {tab === 'raw' && !loading && (
          <div className="space-y-4">
            {/* Contract */}
            <DataSection title="Contract" data={contract} />
            {/* Decision */}
            <DataSection title="Split Decision" data={decision} />
            {/* Output Files */}
            {outputFiles.length > 0 && (
              <div>
                <h4 className="text-[12px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase mb-2">Output Files ({outputFiles.length})</h4>
                <div className="space-y-1">
                  {outputFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px] font-mono text-zinc-700 dark:text-zinc-300">
                      <FileCode size={12} className="text-zinc-400 shrink-0" />
                      <span className="truncate">{f}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Raw JSON */}
            <div>
              <h4 className="text-[12px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase mb-2">Full Row JSON</h4>
              <pre className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
                {JSON.stringify(task, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── DataSection ──

function DataSection({ title, data }: { title: string; data: Record<string, unknown> | null }) {
  if (!data) return null;
  return (
    <div>
      <h4 className="text-[12px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase mb-2">{title}</h4>
      <pre className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-900 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

// ── EmptyState ──

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-zinc-300 dark:text-zinc-600">
      {icon}
      <span className="mt-2 text-[13px]">{text}</span>
    </div>
  );
}

// ── Main Page ──

export default function AgentsPage() {
  const [projects, setProjects] = useState<Array<{ project_name: string; task_count: number; latest_updated: string }>>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskTreeRow[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load projects
  const loadProjects = useCallback(async () => {
    const p = await getAllTaskTreeProjects();
    setProjects(p);
    if (p.length > 0 && !selectedProject) {
      setSelectedProject(p[0].project_name);
    } else if (selectedProject && !p.some(x => x.project_name === selectedProject)) {
      setSelectedProject(p[0]?.project_name ?? null);
    }
  }, [selectedProject]);

  useEffect(() => { loadProjects(); }, []);

  // Auto-refresh every 3s to pick up pipeline data as it's written
  useEffect(() => {
    const timer = setInterval(() => { loadProjects(); }, 3000);
    return () => clearInterval(timer);
  }, [loadProjects]);

  // Load tasks when project changes
  const loadTasks = useCallback(async (project: string) => {
    setLoading(true);
    try {
      const t = await getTaskTreeByProject(project);
      setTasks(t);
      if (!selectedTaskId || !t.some(x => x.id === selectedTaskId)) {
        setSelectedTaskId(t.length > 0 ? t[0].id : null);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedProject) { setTasks([]); setSelectedTaskId(null); return; }
    loadTasks(selectedProject);
  }, [selectedProject]);

  // Auto-refresh tasks every 3s
  useEffect(() => {
    if (!selectedProject) return;
    const timer = setInterval(() => { loadTasks(selectedProject); }, 3000);
    return () => clearInterval(timer);
  }, [selectedProject, loadTasks]);

  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );

  const rootTasks = useMemo(() => tasks.filter(t => !t.parent_module_id || t.depth === 0), [tasks]);

  const handleDelete = useCallback(async () => {
    if (!selectedProject) return;
    if (!confirm(`Delete project "${selectedProject}" and all its data?`)) return;
    await deleteTaskTreeProject(selectedProject);
    setSelectedProject(null);
    setSelectedTaskId(null);
    await loadProjects();
  }, [selectedProject, loadProjects]);

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch size={20} className="text-blue-600 dark:text-blue-400" />
          <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Multi-Agent</h1>
          <span className="text-[12px] text-zinc-400 dark:text-zinc-500">Code Generation Pipeline</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadProjects}
            className="p-1.5 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          {selectedProject && (
            <button
              onClick={handleDelete}
              className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
              title="Delete project"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Content: left tree + right detail */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Project selector + Task tree */}
        <div className="w-[320px] border-r border-zinc-200 dark:border-zinc-800 flex flex-col shrink-0">
          {/* Project selector */}
          <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
            <select
              value={selectedProject ?? ''}
              onChange={(e) => setSelectedProject(e.target.value || null)}
              className="w-full px-2 py-1.5 text-[13px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {projects.length === 0 && <option value="">No projects</option>}
              {projects.map(p => (
                <option key={p.project_name} value={p.project_name}>
                  {p.project_name} ({p.task_count} tasks)
                </option>
              ))}
            </select>
          </div>

          {/* Task tree */}
          <div className="flex-1 overflow-y-auto min-h-0 py-1">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-zinc-400">
                <Loader2 size={16} className="animate-spin mr-2" /> Loading...
              </div>
            ) : projects.length === 0 ? (
              <EmptyState icon={<GitBranch size={32} />} text="No projects yet" />
            ) : tasks.length === 0 ? (
              <EmptyState icon={<GitBranch size={32} />} text="No tasks in this project" />
            ) : (
              rootTasks.map(task => (
                <TaskTreeNode
                  key={task.id}
                  task={task}
                  allTasks={tasks}
                  selectedId={selectedTaskId}
                  onSelect={setSelectedTaskId}
                />
              ))
            )}
          </div>

          {/* Stats footer */}
          {tasks.length > 0 && (
            <div className="px-3 py-2 border-t border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
              {tasks.length} tasks · {tasks.filter(t => t.status === 'done').length} done · {tasks.filter(t => t.status === 'failed').length} failed
            </div>
          )}
        </div>

        {/* Right: Detail panel */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedTask ? (
            <TaskDetailPanel key={selectedTask.id} task={selectedTask} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-300 dark:text-zinc-600">
              <div className="text-center">
                <GitBranch size={48} className="mx-auto mb-3 opacity-50" />
                <p className="text-[14px]">Select a task to view details</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

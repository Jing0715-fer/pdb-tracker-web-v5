'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import {
  Database,
  FlaskConical,
  BookOpen,
  ArrowRight,
  Atom,
  BarChart3,
  Search,
  Keyboard,
  Activity,
  FileText,
  Clock,
  TrendingUp,
  Layers,
  Eye,
  Microscope,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RecentItem {
  id: string;
  title: string;
  type: string;
  date: string;
}

interface WelcomeStateProps {
  mode?: 'weekly' | 'evaluation' | 'literature';
  totalEntries?: number;
  avgResolution?: number;
  cryoemPct?: number;
  totalEvaluations?: number;
  avgCoverage?: number;
  totalPapers?: number;
  avgIf?: number;
  recentItems?: RecentItem[];
  onSelectWeekly?: () => void;
  onSelectEvaluation?: () => void;
  onSelectLiterature?: () => void;
  onOpenSearch?: () => void;
  onShowKeyboardHints?: () => void;
}

const buildModeConfig = (locale: 'en' | 'zh') => ({
  weekly: {
    icon: Database,
    label: locale === 'zh' ? '周报结构' : 'Weekly Structures',
    gradient: 'from-[#2d8f8f] to-[#1a6b6b]',
    color: '#2d8f8f',
    heading: locale === 'zh' ? '浏览每周 PDB 发布' : 'Explore Weekly PDB Releases',
    description: locale === 'zh'
      ? '浏览 PDB 最新蛋白质结构发布。跨周报跟踪方法、分辨率和影响因子。'
      : 'Browse the latest protein structure releases from the PDB. Track methods, resolutions, and impact factors across weekly snapshots.',
  },
  evaluation: {
    icon: FlaskConical,
    label: locale === 'zh' ? '目标评估' : 'Target Evaluations',
    gradient: 'from-[#7c5cbf] to-[#5a3d99]',
    color: '#7c5cbf',
    heading: locale === 'zh' ? '评估目标覆盖率' : 'Evaluate Target Coverage',
    description: locale === 'zh'
      ? '评估蛋白质目标的结构覆盖率。比较结构域覆盖、BLAST 结果和完整性评分。'
      : 'Assess structural coverage for your protein targets. Compare domain coverage, BLAST results, and completeness scores.',
  },
  literature: {
    icon: BookOpen,
    label: locale === 'zh' ? '文献监测' : 'Literature Monitor',
    gradient: 'from-[#c9872e] to-[#a06b1a]',
    color: '#c9872e',
    heading: locale === 'zh' ? '监测结构生物学文献' : 'Monitor Structural Biology Literature',
    description: locale === 'zh'
      ? '跟踪结构生物学最新发表。监测影响因子、阅读进度和引用网络。'
      : 'Track the latest publications in structural biology. Monitor impact factors, reading progress, and citation networks.',
  },
} as const);

function StatBadge({
  label,
  value,
  suffix,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  suffix?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="welcome-stat-badge group flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-claude-border/50 dark:border-[#3d3832]/50 bg-white/60 dark:bg-[#242220]/60 backdrop-blur-sm">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold text-claude-text leading-tight">
          {value}
          {suffix && <span className="font-normal text-claude-text-muted text-[10px] ml-0.5">{suffix}</span>}
        </div>
        <div className="text-[10px] text-claude-text-muted leading-tight truncate">{label}</div>
      </div>
    </div>
  );
}

function RecentActivityItem({ item, index, locale }: { item: RecentItem; index: number; locale: 'en' | 'zh' }) {
  const typeIcons: Record<string, React.ElementType> = {
    structure: Microscope,
    evaluation: Eye,
    paper: FileText,
  };
  const typeColors: Record<string, string> = {
    structure: '#2d8f8f',
    evaluation: '#7c5cbf',
    paper: '#c9872e',
  };
  const Icon = typeIcons[item.type] || FileText;
  const color = typeColors[item.type] || '#6b7280';

  const timeAgo = getTimeAgo(item.date, locale);

  return (
    <div
      className="welcome-recent-item flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-claude-border-light/50 dark:hover:bg-[#2b2926]/50 transition-colors"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: `${color}12` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-claude-text truncate">{item.title}</div>
        <div className="text-[9px] text-claude-text-muted flex items-center gap-1">
          <Clock className="h-2.5 w-2.5" />
          {timeAgo}
        </div>
      </div>
    </div>
  );
}

function getTimeAgo(dateStr: string, locale: 'en' | 'zh' = 'en'): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (locale === 'zh') {
      if (diffMins < 1) return '刚刚';
      if (diffMins < 60) return `${diffMins} 分钟前`;
      const diffHrs = Math.floor(diffMins / 60);
      if (diffHrs < 24) return `${diffHrs} 小时前`;
      const diffDays = Math.floor(diffHrs / 24);
      if (diffDays < 7) return `${diffDays} 天前`;
      return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    }
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    const diffDays = Math.floor(diffHrs / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function TipBadge({
  icon: Icon,
  shortcut,
  description,
}: {
  icon: React.ElementType;
  shortcut: string;
  description: string;
}) {
  return (
    <div className="welcome-tip-badge flex items-center gap-2 px-3 py-2 rounded-lg border border-claude-border/40 dark:border-[#3d3832]/40 bg-white/40 dark:bg-[#1a1917]/40">
      <Icon className="h-3.5 w-3.5 text-claude-text-muted flex-shrink-0" />
      <span className="text-[11px] text-claude-text-secondary">{description}</span>
      <kbd className="welcome-kbd ml-auto flex-shrink-0">{shortcut}</kbd>
    </div>
  );
}

export function WelcomeState({
  mode = 'weekly',
  totalEntries = 0,
  avgResolution,
  cryoemPct,
  totalEvaluations,
  avgCoverage,
  totalPapers,
  avgIf,
  recentItems,
  onSelectWeekly,
  onSelectEvaluation,
  onSelectLiterature,
  onOpenSearch,
  onShowKeyboardHints,
}: WelcomeStateProps) {
  const { t, locale } = useI18n();
  const modeConfig = buildModeConfig(locale)[mode];

  // Build stats based on mode
  const getWeeklyStats = (): Array<{ label: string; value: number | string; suffix?: string; icon: typeof Layers; color: string }> => [
    { label: locale === 'zh' ? '结构总数' : 'Total Structures', value: totalEntries, suffix: undefined, icon: Layers, color: '#2d8f8f' },
    {
      label: locale === 'zh' ? '平均分辨率' : 'Avg Resolution',
      value: avgResolution ? avgResolution.toFixed(1) : '—',
      suffix: avgResolution ? 'Å' : undefined,
      icon: Microscope,
      color: '#c9872e',
    },
    {
      label: 'Cryo-EM',
      value: cryoemPct != null ? `${cryoemPct.toFixed(0)}` : '—',
      suffix: cryoemPct != null ? '%' : undefined,
      icon: Activity,
      color: '#7c5cbf',
    },
  ];

  const getEvaluationStats = (): Array<{ label: string; value: number | string; suffix?: string; icon: typeof Layers; color: string }> => [
    {
      label: locale === 'zh' ? '评估总数' : 'Total Evaluations',
      value: totalEvaluations ?? 0,
      suffix: undefined,
      icon: Eye,
      color: '#7c5cbf',
    },
    {
      label: locale === 'zh' ? '平均覆盖率' : 'Avg Coverage',
      value: avgCoverage != null ? avgCoverage.toFixed(0) : '—',
      suffix: avgCoverage != null ? '%' : undefined,
      icon: TrendingUp,
      color: '#2d8f8f',
    },
    {
      label: locale === 'zh' ? '跟踪目标数' : 'Targets Tracked',
      value: totalEntries || 0,
      suffix: undefined,
      icon: FlaskConical,
      color: '#c9872e',
    },
  ];

  const getLiteratureStats = (): Array<{ label: string; value: number | string; suffix?: string; icon: typeof Layers; color: string }> => [
    {
      label: locale === 'zh' ? '论文总数' : 'Total Papers',
      value: totalPapers ?? 0,
      suffix: undefined,
      icon: BookOpen,
      color: '#c9872e',
    },
    {
      label: locale === 'zh' ? '平均影响因子' : 'Avg Impact Factor',
      value: avgIf != null ? avgIf.toFixed(1) : '—',
      icon: TrendingUp,
      color: '#7c5cbf',
    },
    {
      label: locale === 'zh' ? '跟踪期刊数' : 'Journals Tracked',
      value: totalEntries || 0,
      icon: FileText,
      color: '#2d8f8f',
    },
  ];

  const stats =
    mode === 'weekly'
      ? getWeeklyStats()
      : mode === 'evaluation'
        ? getEvaluationStats()
        : getLiteratureStats();

  // Default recent items if none provided
  const displayItems: RecentItem[] =
    recentItems && recentItems.length > 0
      ? recentItems.slice(0, 3)
      : [
          { id: '1', title: locale === 'zh' ? '选择一种模式开始' : 'Select a mode to get started', type: 'structure', date: new Date().toISOString() },
          { id: '2', title: locale === 'zh' ? '使用 ⌘K 跨所有数据搜索' : 'Use ⌘K to search across all data', type: 'paper', date: new Date().toISOString() },
          { id: '3', title: locale === 'zh' ? '按 1/2/3 切换模式' : 'Press 1/2/3 to switch modes', type: 'evaluation', date: new Date().toISOString() },
        ];

  const tips = [
    { icon: Search, shortcut: '⌘K', description: locale === 'zh' ? '快速搜索' : 'Quick search' },
    { icon: Keyboard, shortcut: '1/2/3', description: locale === 'zh' ? '切换模式' : 'Switch modes' },
    { icon: BarChart3, shortcut: '⌘B', description: locale === 'zh' ? '切换仪表盘' : 'Toggle dashboard' },
  ];

  return (
    <div className="relative flex flex-col items-center justify-start h-full min-h-[500px] px-6 py-8 overflow-y-auto custom-scrollbar welcome-fade-in">
      {/* Gradient background with animated pattern */}
      <div className="welcome-bg-pattern absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[10%] left-[8%] w-48 h-48 rounded-full bg-claude-accent/[0.03] blur-3xl" />
        <div className="absolute bottom-[15%] right-[10%] w-56 h-56 rounded-full bg-[#2d8f8f]/[0.03] blur-3xl" />
        <div className="absolute top-[45%] left-[45%] w-44 h-44 rounded-full bg-[#7c5cbf]/[0.03] blur-3xl" />
        {/* Animated subtle dot grid */}
        <div className="absolute inset-0 bg-pattern-dots opacity-50" />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-lg mx-auto flex flex-col items-center">
        {/* Friendly illustration */}
        <div className="relative mb-6">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-claude-accent/10 via-[#2d8f8f]/10 to-[#7c5cbf]/10 flex items-center justify-center border border-claude-border/30 dark:border-[#3d3832]/30 welcome-icon-float">
            <Atom className="h-10 w-10 text-claude-accent opacity-70" />
          </div>
          {/* Decorative orbiting dots */}
          <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-[#2d8f8f]/20 flex items-center justify-center welcome-dot-1">
            <div className="w-2 h-2 rounded-full bg-[#2d8f8f]/60" />
          </div>
          <div className="absolute -bottom-1 -left-3 w-4 h-4 rounded-full bg-[#7c5cbf]/20 flex items-center justify-center welcome-dot-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#7c5cbf]/60" />
          </div>
          <div className="absolute top-1/2 -right-4 w-3 h-3 rounded-full bg-[#c9872e]/20 flex items-center justify-center welcome-dot-3">
            <div className="w-1 h-1 rounded-full bg-[#c9872e]/60" />
          </div>
        </div>

        {/* Mode-specific welcome message */}
        <div className="text-center mb-5 welcome-text-in">
          <h2 className="text-lg font-bold text-claude-text mb-1.5">{modeConfig.heading}</h2>
          <p className="text-xs text-claude-text-secondary max-w-sm leading-relaxed">
            {modeConfig.description}
          </p>
        </div>

        {/* Quick Stats Grid */}
        <div className="w-full mb-5 welcome-section" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center gap-1.5 mb-2.5">
            <BarChart3 className="h-3.5 w-3.5 text-claude-text-muted" />
            <span className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
              {locale === 'zh' ? '快捷统计' : 'Quick Stats'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {stats.map((stat) => (
              <StatBadge
                key={stat.label}
                label={stat.label}
                value={stat.value}
                suffix={stat.suffix}
                icon={stat.icon}
                color={stat.color}
              />
            ))}
          </div>
        </div>

        {/* Quick action buttons */}
        <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 mb-5 welcome-actions-in" style={{ animationDelay: '200ms' }}>
          <Button
            variant="outline"
            onClick={onSelectWeekly}
            className={`h-10 px-4 gap-2.5 border-claude-border dark:border-[#3d3832] hover:border-[#2d8f8f]/40 hover:bg-[#2d8f8f]/5 transition-all group flex-1 ${mode === 'weekly' ? 'border-[#2d8f8f]/30 bg-[#2d8f8f]/5' : ''}`}
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#2d8f8f] to-[#1a6b6b] flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
              <Database className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="text-left">
              <div className="text-[11px] font-semibold text-claude-text">{locale === 'zh' ? '最新一周' : 'Latest Week'}</div>
              <div className="text-[9px] text-claude-text-muted">{locale === 'zh' ? '浏览结构' : 'Browse structures'}</div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-claude-text-muted ml-auto group-hover:translate-x-0.5 transition-transform" />
          </Button>

          <Button
            variant="outline"
            onClick={onSelectEvaluation}
            className={`h-10 px-4 gap-2.5 border-claude-border dark:border-[#3d3832] hover:border-[#7c5cbf]/40 hover:bg-[#7c5cbf]/5 transition-all group flex-1 ${mode === 'evaluation' ? 'border-[#7c5cbf]/30 bg-[#7c5cbf]/5' : ''}`}
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#7c5cbf] to-[#5a3d99] flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
              <FlaskConical className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="text-left">
              <div className="text-[11px] font-semibold text-claude-text">{locale === 'zh' ? '评估' : 'Evaluations'}</div>
              <div className="text-[9px] text-claude-text-muted">{locale === 'zh' ? '覆盖率分析' : 'Coverage analysis'}</div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-claude-text-muted ml-auto group-hover:translate-x-0.5 transition-transform" />
          </Button>

          <Button
            variant="outline"
            onClick={onSelectLiterature}
            className={`h-10 px-4 gap-2.5 border-claude-border dark:border-[#3d3832] hover:border-[#c9872e]/40 hover:bg-[#c9872e]/5 transition-all group flex-1 ${mode === 'literature' ? 'border-[#c9872e]/30 bg-[#c9872e]/5' : ''}`}
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#c9872e] to-[#a06b1a] flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
              <BookOpen className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="text-left">
              <div className="text-[11px] font-semibold text-claude-text">{locale === 'zh' ? '文献' : 'Literature'}</div>
              <div className="text-[9px] text-claude-text-muted">{locale === 'zh' ? '浏览论文' : 'Browse papers'}</div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-claude-text-muted ml-auto group-hover:translate-x-0.5 transition-transform" />
          </Button>
        </div>

        {/* Recent Activity */}
        <div className="w-full mb-5 welcome-section" style={{ animationDelay: '300ms' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="h-3.5 w-3.5 text-claude-text-muted" />
            <span className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
              {locale === 'zh' ? '最近活动' : 'Recent Activity'}
            </span>
          </div>
          <div className="rounded-xl border border-claude-border/40 dark:border-[#3d3832]/40 bg-white/40 dark:bg-[#242220]/40 backdrop-blur-sm overflow-hidden">
            {displayItems.map((item, i) => (
              <RecentActivityItem key={item.id} item={item} index={i} locale={locale} />
            ))}
          </div>
        </div>

        {/* Tips Section */}
        <div className="w-full welcome-section" style={{ animationDelay: '400ms' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <Keyboard className="h-3.5 w-3.5 text-claude-text-muted" />
            <span className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
              {locale === 'zh' ? '快捷提示' : 'Quick Tips'}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {tips.map((tip) => (
              <TipBadge
                key={tip.shortcut}
                icon={tip.icon}
                shortcut={tip.shortcut}
                description={tip.description}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default WelcomeState;

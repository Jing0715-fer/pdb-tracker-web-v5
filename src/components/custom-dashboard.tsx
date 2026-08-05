'use client';

import React, { useState, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { motion } from 'framer-motion';
import { GripVertical } from 'lucide-react';

/**
 * CustomDashboard
 *
 * A drag-and-drop customizable dashboard layout.
 * Users can rearrange widget cards by dragging them.
 * Widget order is persisted to localStorage.
 *
 * Usage:
 *   <CustomDashboard storageKey="weekly-widgets" widgets={widgets} />
 */

interface Widget {
  id: string;
  title: string;
  content: React.ReactNode;
  defaultVisible?: boolean;
}

interface CustomDashboardProps {
  storageKey: string;
  widgets: Widget[];
}

interface SortableWidgetProps {
  widget: Widget;
  isDragging: boolean;
}

function SortableWidget({ widget, isDragging }: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: widget.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-surface dark:bg-[#242220] overflow-hidden"
    >
      {/* Header with drag handle */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-claude-border/30 dark:border-[#3d3832]/30">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-claude-text-muted hover:text-claude-text transition-colors touch-none"
          title="Drag to reorder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
          {widget.title}
        </span>
      </div>
      {/* Content */}
      <div className="p-3">
        {widget.content}
      </div>
    </div>
  );
}

export function CustomDashboard({ storageKey, widgets }: CustomDashboardProps) {
  const [order, setOrder] = useState<string[]>(() => {
    if (typeof window === 'undefined') return widgets.map(w => w.id);
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          // Merge stored order with any new widgets
          const newIds = widgets.filter(w => !parsed.includes(w.id)).map(w => w.id);
          return [...parsed.filter((id: string) => widgets.some(w => w.id === id)), ...newIds];
        }
      }
    } catch {
      // ignore
    }
    return widgets.map(w => w.id);
  });

  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(order));
    } catch {
      // ignore
    }
  }, [order, storageKey]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOrder((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
    setActiveId(null);
  };

  const orderedWidgets = order
    .map(id => widgets.find(w => w.id === id))
    .filter((w): w is Widget => w !== undefined);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setActiveId(e.active.id as string)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {orderedWidgets.map((widget) => (
            <motion.div
              key={widget.id}
              layout
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <SortableWidget widget={widget} isDragging={activeId === widget.id} />
            </motion.div>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

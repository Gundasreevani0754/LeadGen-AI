"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ScoreBadge } from "@/components/ui/score-badge";
import {
  PIPELINE_STATUSES,
  STATUS_LABELS,
  type LeadRow,
  type PipelineBoard,
  type PipelineStatus,
} from "@/lib/leads/constants";
import { moveStatusAction } from "../leads/actions";

/**
 * The Kanban board.
 *
 * Drag and drop is the fast path, and every card also carries a select, because
 * a board that can only be operated with a mouse is a board that cannot be
 * operated from a keyboard at all. Both routes call the same server action, so
 * the event log records them identically.
 */
export function Board({
  board,
  threshold,
}: {
  board: PipelineBoard;
  threshold: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<PipelineStatus | null>(null);

  function move(businessId: string, status: PipelineStatus) {
    const data = new FormData();
    data.set("businessId", businessId);
    data.set("status", status);

    startTransition(async () => {
      await moveStatusAction(data);
      router.refresh();
    });
  }

  return (
    <div
      className={`grid gap-4 overflow-x-auto pb-4 ${pending ? "opacity-70" : ""}`}
      style={{ gridTemplateColumns: `repeat(${PIPELINE_STATUSES.length}, minmax(14rem, 1fr))` }}
    >
      {PIPELINE_STATUSES.map((status) => {
        const column = board[status] ?? [];

        return (
          <section
            key={status}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver((current) => (current === status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const id = event.dataTransfer.getData("text/plain") || dragging;
              if (id) move(id, status);
              setDragging(null);
            }}
            className={`min-w-0 rounded-lg border p-3 transition-colors ${
              over === status
                ? "border-accent/50 bg-accent-soft/40"
                : "border-rule bg-paper-sunk/40"
            }`}
          >
            <header className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="label-micro">{STATUS_LABELS[status]}</h2>
              <span className="text-xs tabular-nums text-ink-faint">{column.length}</span>
            </header>

            <ul className="space-y-2">
              {column.map((lead) => (
                <Card
                  key={lead.id}
                  lead={lead}
                  threshold={threshold}
                  onDragStart={() => setDragging(lead.id)}
                  onMove={move}
                />
              ))}

              {column.length === 0 && (
                <li className="rounded border border-dashed border-rule px-3 py-6 text-center text-xs text-ink-faint">
                  Empty
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Card({
  lead,
  threshold,
  onDragStart,
  onMove,
}: {
  lead: LeadRow;
  threshold: number;
  onDragStart: () => void;
  onMove: (businessId: string, status: PipelineStatus) => void;
}) {
  return (
    <li
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", lead.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      className="cursor-grab rounded-md border border-rule bg-paper-raised p-3 shadow-[0_1px_2px_oklch(0%_0_0/0.04)] active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/leads/${lead.id}`}
          className="min-w-0 flex-1 text-sm leading-tight font-medium hover:text-accent"
        >
          {lead.name}
        </Link>
        <ScoreBadge score={lead.score} threshold={threshold} size="sm" />
      </div>

      <p className="mt-1 truncate text-xs text-ink-faint">
        {lead.city ?? "—"}
        {lead.hasBrief && " · briefed"}
      </p>

      <label className="mt-2 block">
        <span className="sr-only">Move {lead.name} to another status</span>
        <select
          value={lead.status}
          onChange={(event) => onMove(lead.id, event.target.value as PipelineStatus)}
          className="w-full rounded border border-rule bg-paper px-1.5 py-1 text-[11px] text-ink-muted"
        >
          {PIPELINE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

# Flowchart Improvements (N8N-Inspired)

This document outlines enhancements inspired by N8N's workflow editor for future implementation.

## Current State

- **Layout**: Auto-layout (grid or swimlane) via SVG
- **Interaction**: Pan (drag), zoom (buttons + Ctrl+wheel), click-to-select step
- **Connectors**: Static paths between node centers

## N8N-Style Enhancements

### 1. Connector Behavior
- **Connection handles**: Nodes could expose explicit connection points (input/output handles) instead of implicit center-to-center paths
- **Edge routing**: Bezier curves that avoid overlapping nodes; connectors bring selected edges to front
- **Visual feedback**: Hover state on connectors; highlight path on edge hover

### 2. Moving Nodes on Canvas
- **Draggable nodes**: Allow repositioning steps on the canvas (requires storing `{x, y}` per step)
- **Grid snapping**: Snap to grid for alignment (e.g. 20px)
- **Re-layout on drag**: Option to auto-reflow connections when a node moves

### 3. Canvas UX
- **Pan**: Already supported via drag; consider two-finger trackpad pan
- **Zoom**: Already supported; ensure zoom centers on cursor
- **Minimap**: Optional overview for large flows
- **Selection**: Multi-select nodes (Shift+click) for bulk actions

### 4. Implementation Options

**Option A – React Flow (@xyflow/react)**
- Pros: Built-in nodes, edges, drag, zoom, pan, handles
- Cons: New dependency; need to map process steps to React Flow nodes/edges
- Effort: Medium–high

**Option B – Incremental SVG Enhancements**
- Keep current SVG renderer
- Add position state per step; render at `(x, y)` instead of grid
- Add drag handlers on node elements
- Pros: No new deps; full control
- Cons: More custom code for edge routing, handles
- Effort: Medium

**Option C – Hybrid**
- Use React Flow for the interactive canvas in "edit" mode
- Keep SVG for read-only export/report views
- Effort: High

## Recent Improvements (Done)

- Fit-to-screen zoom with ⊡ button
- Department pane freeze in swimlane (docked and floating)
- Grab/pan for swimlane view
- Zoom controls in preview and floating window

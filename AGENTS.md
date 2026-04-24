# AGENTS.md — Engineering Quality Standards

## Core Mandate

Every AI agent working on this codebase must produce work indistinguishable from a senior frontend engineer who obsesses over user experience. Code must be organized, complete, and polished — no shortcuts, no half-measures.

## UI/UX Excellence (Non-Negotiable)

### State Management — Handle EVERY State

Every user-facing component MUST handle all possible states. No exceptions.

| State | Required | What It Means |
|-------|----------|---------------|
| **Loading** | ✅ | Skeleton screens, spinners, or shimmer effects — never a blank screen |
| **Empty** | ✅ | Friendly empty states with guidance — never just "No data" |
| **Success** | ✅ | Clear confirmation — toasts, checkmarks, subtle animations |
| **Error** | ✅ | Actionable error messages with retry options — never raw error strings |
| **Partial failure** | ✅ | Graceful degradation — show what worked, highlight what didn't |
| **Offline** | ✅ | Handle network loss gracefully with cached data or clear messaging |
| **Stale data** | ✅ | Indicate when data may be outdated, offer refresh |

**Anti-patterns (BLOCKED):**
- Empty `catch(e) {}` blocks
- `// TODO: handle error` comments left in production code
- Loading states that show nothing (blank white/dark screens)
- Error messages showing raw exception text to users
- Components that crash instead of showing fallback UI

### Micro-interactions & Animations

Every interactive element MUST have feedback. Users should never wonder "did that click register?"

- **Button press**: Subtle scale (0.98) + opacity shift on press, smooth color transition on hover
- **Page transitions**: Fade or slide transitions between views (150-250ms)
- **List items**: Stagger entrance animations for lists loading in
- **Toasts/notifications**: Slide in from edge + subtle spring, auto-dismiss with progress indicator
- **Form validation**: Inline validation with smooth error message reveal (not jarring pop-in)
- **Toggles/switches**: Smooth thumb translation with spring physics
- **Skeleton loading**: Subtle shimmer/pulse animation, matching the layout of actual content
- **Hover states**: Every clickable element must visually respond to hover within 50ms

**Animation principles:**
- Duration: 100-150ms for micro-interactions, 200-300ms for layout shifts, 300-500ms for page transitions
- Easing: Use `ease-out` for entrances, `ease-in` for exits, `ease-in-out` for state changes
- Spring physics preferred for interactive elements (natural, not robotic)
- Animations must respect `prefers-reduced-motion` — provide static alternatives

### Edge Cases

Think about and handle:
- **Empty strings** — Trim inputs, validate meaningful content
- **Extremely long text** — Truncate with ellipsis, provide expand/tooltip
- **Rapid clicking** — Debounce actions, disable buttons during async operations
- **Race conditions** — Cancel stale requests, use abort controllers
- **Concurrent modifications** — Handle optimistic updates with rollback
- **Browser back/forward** — Preserve state across navigation
- **Tab focus order** — Logical keyboard navigation through all interactive elements
- **Screen reader announcements** — ARIA live regions for dynamic content changes
- **Clipboard operations** — Visual feedback on copy/paste actions
- **Drag boundaries** — Constrain draggable elements, handle drop outside valid zones

### Visual Consistency

- **Always match the design system** defined in `DESIGN.md` — colors, typography, spacing, border radius
- Never introduce ad-hoc colors, font sizes, or spacing values
- Use design tokens/CSS variables — never hardcode hex values in components
- Components must look correct in both the primary dark theme and any future light theme
- Maintain consistent iconography style (size, stroke width, visual weight)

### Error Boundaries

- Every major section/route MUST have an error boundary
- Error boundaries show a friendly fallback UI, not a white screen
- Error boundaries log the error for debugging
- Error boundaries offer a "Try again" action when possible
- Nested error boundaries for independent sections (sidebar error shouldn't crash main content)

### Performance as UX

- **Perceived performance** matters more than raw numbers
- Show optimistic UI updates, confirm with server response
- Lazy load routes and heavy components
- Virtualize long lists (100+ items)
- Debounce search inputs (300ms)
- Throttle scroll/resize handlers (16ms / frame)
- Preload critical resources, defer non-essential ones

## Code Organization

- **Co-locate** related files (component + styles + tests + types in same directory)
- **Single responsibility** — one component does one thing well
- **Extract early** — if a component exceeds ~150 lines, split it
- **Name clearly** — component names describe what they render, hook names describe what they provide
- **Type everything** — no `any`, no `unknown` without explicit justification
- **Document why, not what** — comments explain reasoning, not mechanics

## Quality Checklist (Before Every PR)

- [ ] All states handled (loading, empty, error, success, partial failure)
- [ ] All interactive elements have hover/focus/active feedback
- [ ] Animations respect `prefers-reduced-motion`
- [ ] Error boundaries wrap major sections
- [ ] No TypeScript errors or warnings
- [ ] Keyboard navigation works for all interactive elements
- [ ] Design system tokens used (no hardcoded colors/spacing)
- [ ] Edge cases considered and handled (long text, rapid clicks, empty data)
- [ ] Console is clean (no warnings, no uncaught errors)

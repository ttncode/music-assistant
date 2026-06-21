# Auth Screens Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a centered splash-style logo + app name to AuthScreen and DeviceNameScreen so both screens have consistent branding.

**Architecture:** Inline edits to two existing components. The branded block is three lines of JSX (icon + label) copied into both files — no new component needed at this scale. `MusicNote` from `@phosphor-icons/react` is already used in `Header.tsx` so no new dependency.

**Tech Stack:** React, TypeScript, Tailwind CSS v4, `@phosphor-icons/react`.

## Global Constraints

- Icon: `MusicNote`, weight `"fill"`, size `40`, class `text-[var(--color-accent)]`
- App name label: `text-2xl font-semibold tracking-tight`, centered
- Branded block wrapper: `flex flex-col items-center gap-1`
- Gap between branded block and form content: `space-y-6` on the parent form, or a `mb-6` spacer — match whichever pattern the file already uses
- Version label (`v{__APP_VERSION__}`) stays fixed bottom-center — do not move it
- Do not add new files or extract a shared component

---

### Task 1: Add branded header to AuthScreen and DeviceNameScreen

**Files:**
- Modify: `web/src/components/AuthScreen.tsx`
- Modify: `web/src/components/DeviceNameScreen.tsx`

**Interfaces:**
- Consumes: `MusicNote` from `@phosphor-icons/react`; `__APP_VERSION__` global (already declared in `web/src/app-version.d.ts`)
- Produces: visual change only — no new exports

- [ ] **Step 1: Update AuthScreen**

Open `web/src/components/AuthScreen.tsx`. The current file looks like:

```tsx
import { useState, FormEvent } from 'react'
import { api } from '../lib/api'

interface Props {
  onVerified: () => void
}

export function AuthScreen({ onVerified }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.auth.verify(code)
      onVerified()
    } catch {
      setError('Wrong code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <p className="fixed bottom-4 left-0 right-0 text-center text-[10px] text-[var(--color-text-muted)]">v{__APP_VERSION__}</p>
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Music Assistant</h1>
        <div className="space-y-1">
          <p className="text-[var(--color-text-secondary)] text-sm">Enter your access code to continue.</p>
          ...
        </div>
        ...
      </form>
    </div>
  )
}
```

Replace it with:

```tsx
import { useState, FormEvent } from 'react'
import { MusicNote } from '@phosphor-icons/react'
import { api } from '../lib/api'

interface Props {
  onVerified: () => void
}

export function AuthScreen({ onVerified }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.auth.verify(code)
      onVerified()
    } catch {
      setError('Wrong code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <p className="fixed bottom-4 left-0 right-0 text-center text-[10px] text-[var(--color-text-muted)]">v{__APP_VERSION__}</p>
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-1">
          <MusicNote size={40} weight="fill" className="text-[var(--color-accent)]" />
          <span className="text-2xl font-semibold tracking-tight">Music Assistant</span>
        </div>

        <div className="space-y-1">
          <p className="text-[var(--color-text-secondary)] text-sm">Enter your access code to continue.</p>
          <p className="text-[var(--color-text-secondary)] text-sm">
            Don't have an access code? Contact the admin at{' '}
            <a
              href="mailto:ttn.dev.fullstack@gmail.com"
              className="text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              ttn.dev.fullstack@gmail.com
            </a>
            {' '}to request one.
          </p>
        </div>

        <div className="space-y-2">
          <input
            type="password"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Access code"
            autoFocus
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
          />
          {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={loading || !code}
          className="w-full cursor-pointer rounded-lg bg-[var(--color-accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {loading ? 'Checking...' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
```

Key changes from original:
- Added `import { MusicNote } from '@phosphor-icons/react'`
- Replaced `<h1>Music Assistant</h1>` with the branded block (`flex flex-col items-center gap-1` + icon + span)
- Changed form `space-y-4` → `space-y-6` (more breathing room between the larger header and form fields)

- [ ] **Step 2: Update DeviceNameScreen**

Open `web/src/components/DeviceNameScreen.tsx`. Replace it with:

```tsx
import { useState, FormEvent } from 'react'
import { MusicNote } from '@phosphor-icons/react'
import { useDevice } from '../hooks/useDevice'

interface Props {
  onRegistered: () => void
}

export function DeviceNameScreen({ onRegistered }: Props) {
  const { register } = useDevice()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register(name.trim())
      onRegistered()
    } catch {
      setError('Failed to register device. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <p className="fixed bottom-4 left-0 right-0 text-center text-[10px] text-[var(--color-text-muted)]">v{__APP_VERSION__}</p>
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-1">
          <MusicNote size={40} weight="fill" className="text-[var(--color-accent)]" />
          <span className="text-2xl font-semibold tracking-tight">Music Assistant</span>
        </div>

        <div>
          <h1 className="text-lg font-medium text-[var(--color-text-secondary)]">Name this device</h1>
          <p className="text-[var(--color-text-secondary)] text-sm mt-1">
            Give this device a name so you can track downloads separately. You can change it later.
          </p>
        </div>

        <div className="space-y-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. iPhone Main, Work Laptop"
            autoFocus
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
          />
          {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {loading ? 'Saving...' : 'Save and continue'}
        </button>
      </form>
    </div>
  )
}
```

Key changes from original:
- Added `import { MusicNote } from '@phosphor-icons/react'`
- Added branded block (`flex flex-col items-center gap-1` + icon + span) above the screen title
- "Name this device" demoted from `text-2xl font-semibold` h1 to `text-lg font-medium text-[var(--color-text-secondary)]` h1 — creates clear hierarchy: brand → screen title → form
- Changed form `space-y-4` → `space-y-6`

- [ ] **Step 3: Verify visually**

Start the dev server:
```bash
cd web && npm run dev
```

Open `http://localhost:5173` in a browser (or whatever port Vite reports).

Check AuthScreen (shown on first load if no device is registered):
- MusicNote icon (green, size 40) centered above "Music Assistant"
- Description text and input below with good spacing
- Version label at bottom

Check DeviceNameScreen (shown after entering the access code):
- Same branded block at top
- "Name this device" appears smaller and muted below the brand
- Input and button below

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AuthScreen.tsx web/src/components/DeviceNameScreen.tsx
git commit -m "feat: add centered logo and app name to auth and device screens"
```

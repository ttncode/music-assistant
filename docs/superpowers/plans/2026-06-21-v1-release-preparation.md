# V1 Release Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a clean `main`/`develop` branch strategy, remove internal tooling artifacts from `main`, add GitHub Actions CI/CD, and publish the first Docker image to GHCR as `v1.0.0`.

**Architecture:** Two GitHub Actions workflows — `ci.yml` (test on every push/PR) and `release.yml` (test + build + push to GHCR on version tags). `develop` branch preserves full history; `main` is cleaned of `.superpowers/` artifacts before CI is added.

**Tech Stack:** GitHub Actions, Docker (multi-stage build), GHCR (`ghcr.io`), Python 3.12 / pytest, Node 20 / Vite.

## Global Constraints

- Registry: `ghcr.io/ttncode/music-assistant`
- Version tag format: `v<major>.<minor>.<patch>` (e.g. `v1.0.0`)
- Image tags pushed on release: `:<version>` and `:latest`
- Python test runner: `pytest tests/ -q` from `api/` directory with `PYTHONPATH=.`
- `GITHUB_TOKEN` is used for GHCR auth — no external secrets required
- Branch `main` gets GitHub branch protection (no direct pushes) after CI is confirmed working

---

### Task 1: Create `develop` branch

**Files:**
- No file changes — git operation only

**Interfaces:**
- Produces: `develop` branch at GitHub tracking `origin/develop`, identical to current `main` tip

- [ ] **Step 1: Create and push `develop` branch**

```bash
git checkout -b develop
git push -u origin develop
```

Expected output:
```
Branch 'develop' set up to track remote branch 'develop' from 'origin'.
```

- [ ] **Step 2: Return to `main`**

```bash
git checkout main
```

- [ ] **Step 3: Verify branches**

```bash
git branch -a
```

Expected: both `main` and `remotes/origin/develop` are listed.

---

### Task 2: Clean `main` branch

**Files:**
- Delete: `.superpowers/` (entire directory, tracked by git)
- Modify: `.gitignore` — add `.superpowers/` entry

**Interfaces:**
- Produces: `main` with `.superpowers/` removed from git history and gitignored

- [ ] **Step 1: Remove `.superpowers/` from git tracking**

```bash
git rm -r .superpowers/
```

Expected: lists each file under `.superpowers/` being removed.

- [ ] **Step 2: Add `.superpowers/` to `.gitignore`**

Open `.gitignore` and append at the bottom:

```
# Superpowers internal tooling
.superpowers/
```

- [ ] **Step 3: Stage the gitignore change**

```bash
git add .gitignore
```

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove internal tooling artifacts from main"
```

- [ ] **Step 5: Verify `.superpowers/` is gone**

```bash
ls -la | grep superpowers
```

Expected: no output (directory is gone from working tree).

- [ ] **Step 6: Push `main`**

```bash
git push origin main
```

---

### Task 3: Add CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: GitHub Actions job that runs `pytest` on push to `main` or `develop`, and on PRs targeting `main`

- [ ] **Step 1: Create the workflows directory**

```bash
mkdir -p .github/workflows
```

- [ ] **Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: pip install -r api/requirements.txt

      - name: Run tests
        working-directory: api
        env:
          PYTHONPATH: .
        run: pytest tests/ -q
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add CI workflow (test on push and PR)"
```

- [ ] **Step 4: Push and verify CI runs**

```bash
git push origin main
```

Then open `https://github.com/ttncode/music-assistant/actions` — confirm the `CI` workflow appears and the `test` job passes (green checkmark).

---

### Task 4: Add release workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Produces: GitHub Actions job that, on push of a `v*.*.*` tag, runs tests then builds and pushes the Docker image to GHCR as `:<version>` and `:latest`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    tags:
      - "v*.*.*"

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: pip install -r api/requirements.txt

      - name: Run tests
        working-directory: api
        env:
          PYTHONPATH: .
        run: pytest tests/ -q

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=tag
            type=raw,value=latest

      - name: Build and push Docker image
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow (build and push to GHCR on version tag)"
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

---

### Task 5: Update README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: README with real GitHub URL, GHCR pull instructions

- [ ] **Step 1: Replace `<repo-url>` placeholder**

In `README.md`, find:

```bash
git clone <repo-url>
```

Replace with:

```bash
git clone https://github.com/ttncode/music-assistant.git
```

- [ ] **Step 2: Add GHCR pull instructions**

After the existing `## Quick Start` section (after the numbered steps block), add a new subsection:

```markdown
### Using the pre-built image

Instead of building from source, pull the published image from GHCR:

```bash
# Pull latest release
docker pull ghcr.io/ttncode/music-assistant:latest

# Or pin to a specific version
docker pull ghcr.io/ttncode/music-assistant:v1.0.0
```

Then update `docker-compose.yml` to use the pulled image instead of building:

```yaml
services:
  app:
    image: ghcr.io/ttncode/music-assistant:latest
    ports:
      - "8000:8000"
    volumes:
      - ./data:/data
      - ${HOME}/music/music-assistant:/music
    env_file: .env
    restart: unless-stopped
```
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README with real repo URL and GHCR pull instructions"
```

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

### Task 6: Tag and release v1.0.0

**Files:**
- No file changes — git tag operation only

**Interfaces:**
- Produces: `v1.0.0` tag on `main`; Docker image `ghcr.io/ttncode/music-assistant:v1.0.0` and `:latest` published to GHCR

- [ ] **Step 1: Confirm CI is green on `main`**

Open `https://github.com/ttncode/music-assistant/actions` and verify the latest `CI` run on `main` shows all jobs passing.

- [ ] **Step 2: Create and push the `v1.0.0` tag**

```bash
git tag v1.0.0
git push origin v1.0.0
```

- [ ] **Step 3: Verify the release workflow triggers**

Open `https://github.com/ttncode/music-assistant/actions` — confirm the `Release` workflow appears for tag `v1.0.0`. Watch it complete (test → build → push). Typical runtime: 3–6 minutes.

- [ ] **Step 4: Verify the image on GHCR**

Open `https://github.com/ttncode/music-assistant/pkgs/container/music-assistant` — confirm both `v1.0.0` and `latest` tags are listed.

- [ ] **Step 5: (Optional) Enable branch protection on `main`**

In GitHub: Settings → Branches → Add branch protection rule for `main`:
- Check "Require a pull request before merging"
- Uncheck "Require approvals" (solo project — PR creation is enough to prevent accidental direct pushes)
- Check "Do not allow bypassing the above settings"

This prevents accidental direct pushes to `main` going forward.

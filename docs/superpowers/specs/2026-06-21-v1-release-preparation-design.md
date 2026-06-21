# V1 Release Preparation Design

**Date:** 2026-06-21

## Goal

Prepare the music-assistant project for its first public release by establishing a clean branch strategy, removing internal tooling artifacts from `main`, and setting up GitHub Actions CI/CD that runs tests on every push and publishes a Docker image to GHCR on version tags.

## Branch Strategy

`main` is the stable release branch. `develop` is the day-to-day working branch. Only `main` is ever tagged and released.

```
main      ──●──────────────────●── (v1.0.0 tag) ──●── ...
             \                /
develop        ●──●──●──●──●
```

- `develop` is created from the current `main` tip
- All feature work happens on `develop`; `main` is updated only via PR merge when ready to ship
- GitHub branch protection on `main`: require PRs, no direct pushes (after the initial cleanup commit)

## Main Branch Cleanup

The following are removed from `main` (deleted from git tracking):

| Path | Reason |
|---|---|
| `.superpowers/` | Internal tooling scratch — task briefs, review diffs, progress notes |

`.superpowers/` is also added to `.gitignore` so it is never accidentally re-committed from `develop`.

The following are kept on `main`:

| Path | Reason |
|---|---|
| `docs/superpowers/specs/` | Design history — explains architectural decisions |
| `docs/superpowers/plans/` | Implementation plans — useful project record |
| `data/songs.json` | Seed file — gives new users a valid initial empty state |

## CI/CD Workflows

Two GitHub Actions workflows live in `.github/workflows/`.

### `ci.yml` — Continuous Integration

**Triggers:** push to `main`, push to `develop`, pull request targeting `main`

**Steps:**
1. Checkout code
2. Set up Python 3.12
3. Install dependencies (`pip install -r api/requirements.txt`)
4. Run test suite (`pytest api/tests/`)

### `release.yml` — Release to GHCR

**Triggers:** push of a tag matching `v*.*.*`

**Steps:**
1. Run full test suite (identical to `ci.yml`)
2. Log in to GHCR (`ghcr.io`) using the built-in `GITHUB_TOKEN` — no external secrets required
3. Build the Docker image (existing multi-stage Dockerfile: web builder → Python app)
4. Push two tags:
   - `ghcr.io/ttncode/music-assistant:<version>` (e.g. `:v1.0.0`)
   - `ghcr.io/ttncode/music-assistant:latest`

## First Release Execution Sequence

1. Create `develop` branch from current `main` tip
2. On `main`:
   - `git rm -r .superpowers/`
   - Add `.superpowers/` to `.gitignore`
   - Commit: `chore: clean main branch for release`
3. Add `.github/workflows/ci.yml`
4. Add `.github/workflows/release.yml`
5. Commit: `ci: add GitHub Actions workflows`
6. Push `main` → CI runs tests (confirms setup is working)
7. Tag `v1.0.0` on `main` → release workflow builds and pushes image to GHCR
8. Update `README.md`: replace `<repo-url>` placeholder with the actual GitHub URL; add GHCR pull instructions

## Ongoing Release Flow

```
develop  →  (PR)  →  main  →  tag vX.Y.Z  →  GHCR image pushed
```

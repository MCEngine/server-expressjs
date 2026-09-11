---
name: memory-tasks-news-and-pages
description: News with Markdown bodies, a policy page, a CI/CD page, and a left-hand navigation — the confirmed eight-task plan across two repositories.
---

# Task: News, two reference pages, and a nav that has outgrown the top bar

## Why

Asked for: a policy page; a CI/CD page carrying both a GitHub Actions and a GitLab CI file a
developer can copy and set two variables on; and news — a list that loads ten at a time as you
scroll, a detail page, create and edit pages written in **Markdown** rather than HTML, and a
settings page with hide and delete behind a confirmation. Plus a navigation that moves to the
left and follows the scroll, because the top bar now carries eight items.

## The decisions that were not in the request

**Who may write news.** This service has no staff role — an account is a `user` or an `org`, and
nothing marks an operator. Letting any signed-in account publish platform news means the first
stranger who registers can post to the front page. So creation is gated by `NEWS_AUTHORS`, a
comma-separated list of handles, **empty by default**: a fresh deployment has no news authors and
says so, and the operator adds their own handle. Editing, hiding and deleting belong to the
author of the piece.

**Hidden, not deleted.** `hidden_at` is a timestamp rather than a boolean, so the record says when
it was pulled rather than only that it was. A hidden item is absent from the public list and
`404` to anyone who may not edit it — not `403`, which would confirm it exists.

**Markdown is rendered without a dependency and without `dangerouslySetInnerHTML`.** The panel has
three runtime dependencies and the point of adding a Markdown library would be to turn text into
HTML, which is the operation that needs sanitizing. A parser that produces React elements cannot
inject HTML at all: raw HTML in the source renders as text, because that is what it is.

**Addressed by id.** The request says `/news/:news_id`, so news carries no slug and no second
namespace to keep unique.

## The plan

| # | Title | Scope | Repository | Branch | Files / areas | PR |
|---|---|---|---|---|---|---|
| 1 | Task record | This file and its index row | `server-expressjs` | `chore/news-and-pages-plan` | `.agents/memory/` | |
| 2 | News on the server | Table, module, routes, the author allowlist | `server-expressjs` | `feat/news` | `src/db/`, `src/modules/news/`, `src/config.ts`, `wiki/`, `test/` | |
| 3 | Release | Changelog, state | `server-expressjs` | `chore/news-and-pages-release` | `wiki/logs/`, `.agents/memory/state/` | |
| 4 | The navigation moves left | A floating sidebar that follows the scroll, and a drawer on a phone | `client-reactjs` | `feat/sidebar-nav` | `src/App.tsx`, `src/styles/layout.css`, `test/` | |
| 5 | Markdown, as React | A parser producing elements, never HTML | `client-reactjs` | `feat/markdown` | `src/components/Markdown.tsx`, `test/` | |
| 6 | The news pages | List, detail, create, edit, settings | `client-reactjs` | `feat/news-pages` | `src/routes/news/`, `src/App.tsx`, `test/` | |
| 7 | Policy and CI/CD | Two reference pages, with both CI files | `client-reactjs` | `feat/reference-pages` | `src/routes/`, `test/` | |
| 8 | Release | Changelog, state, close the panel's record | `client-reactjs` | `chore/news-and-pages-release` | `wiki/logs/`, `.agents/memory/state/` | |

Tasks 1–3 merge first: task 6 calls routes that do not exist until task 2 lands. Tasks 4, 5 and 7
depend on nothing but stack in the panel's repository behind each other.

## Entries

### Task 1 — chore/news-and-pages-plan

This record and its row in `.agents/index/memory-index.md`. Nothing else.

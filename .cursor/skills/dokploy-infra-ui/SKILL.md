---
name: dokploy-infra-ui
description: >-
  Redesigns and polishes Dokploy infrastructure panel UI (Domains, Cloudflare DNS,
  zones, domain connection, DNS providers) within the existing dashboard design
  system. Use when working on Domains, Cloudflare settings, infrastructure panel,
  DNS automation, zone grids, domain connection panels, or UI polish/redesign of
  those surfaces.
---

# Dokploy Infrastructure UI

Craft-quality redesign for Domains / Cloudflare infrastructure surfaces inside Dokploy’s existing dashboard. Elevate presentation; do not invent a new product theme or recreate removed email hosting.

## When to use

Apply this skill when:

- Editing or redesigning Domains page, Cloudflare zones, DNS settings, domain connection, or Cloudflare controls on application/compose domains
- User mentions Domains, Cloudflare, infrastructure panel, DNS automation, zones, or UI polish for those areas
- Adding empty/loading/error states, dialogs, or forms for infrastructure DNS

**Out of scope:** Email hosting UI (removed — do not recreate). Full sidebar redesign. Purple SaaS / generic AI landing-page themes.

## Project constraints (CRITICAL)

1. Follow the craft principles in `.claude/skills/frontend-design/SKILL.md` (distinctive, intentional typography/color/motion/spatial composition — not generic AI slop).
2. BUT because we are inside Dokploy's existing dashboard, **adhere to Dokploy's established visual language** (existing Card/Button/Table/Sidebar patterns, tokens, spacing, typography already used in `apps/dokploy/components`). Do not invent a purple SaaS theme or fight the design system — elevate within it.
3. Scope: infrastructure panel surfaces we built (Domains, Cloudflare DNS settings, domain connection UI, etc.). Emails were REMOVED — do not recreate email UI.

## Hard rules

When doing frontend design tasks, avoid generic, overbuilt layouts.

**Use these hard rules:**

- One composition: The first viewport must read as one composition, not a dashboard (unless it's a dashboard).
- Brand first: On branded pages, the brand or product name must be a hero-level signal, not just nav text or an eyebrow. No headline should overpower the brand.
- Brand test: If the first viewport could belong to another brand after removing the nav, the branding is too weak.
- Typography: Use expressive, purposeful fonts and avoid default stacks (Inter, Roboto, Arial, system).
- Background: Don't rely on flat, single-color backgrounds; use gradients, images, or subtle patterns to build atmosphere.
- Full-bleed hero only: On landing pages and promotional surfaces, the hero image should be a dominant edge-to-edge visual plane or background by default. Do not use inset hero images, side-panel hero images, rounded media cards, tiled collages, or floating image blocks unless the existing design system clearly requires it.
- Hero budget: The first viewport should usually contain only the brand, one headline, one short supporting sentence, one CTA group, and one dominant image. Do not place stats, schedules, event listings, address blocks, promos, "this week" callouts, metadata rows, or secondary marketing content in the first viewport.
- No hero overlays: Do not place detached labels, floating badges, promo stickers, info chips, or callout boxes on top of hero media.
- Cards: Default: no cards. Never use cards in the hero. Cards are allowed only when they are the container for a user interaction. If removing a border, shadow, background, or radius does not hurt interaction or understanding, it should not be a card.
- One job per section: Each section should have one purpose, one headline, and usually one short supporting sentence.
- Real visual anchor: Imagery should show the product, place, atmosphere, or context. Decorative gradients and abstract backgrounds do not count as the main visual idea.
- Reduce clutter: Avoid pill clusters, stat strips, icon rows, boxed promos, schedule snippets, and multiple competing text blocks.
- Use motion to create presence and hierarchy, not noise. Ship at least 2-3 intentional motions for visually led work.
- Color & Look: Choose a clear visual direction; define CSS variables. AVOID defaulting to looks where AI-generated design tends to cluster: (1) purple-on-white or purple-to-indigo gradient themes; (2) a warm cream background (near #F4F1EA) with a high-contrast serif display and a terracotta accent; (3) a broadsheet-style layout with hairline rules, zero border-radius, and dense newspaper-like columns. Avoid biases to: dark mode; purple; glow effects; rounded-full pills; multi-layer shadows; emojis.
- Ensure the page loads properly on both desktop and mobile.
- For React code, prefer modern patterns including useEffectEvent, startTransition, and useDeferredValue when appropriate if used by the team. Do not add useMemo/useCallback by default unless already used; follow the repo's React Compiler guidance.

Exception: If working within an existing website or design system, preserve the established patterns, structure, and visual language.

**Dashboard adaptation:** Domains / settings are dashboards — use Dokploy’s nested Card shell and existing fonts/tokens. Apply hero/brand/full-bleed rules only to marketing surfaces, not these pages. Prefer Dokploy Card patterns for interactive panels; still avoid decorative nested cards that do not aid interaction.

## Match Dokploy visual language

Before redesigning, inspect sibling pages for patterns:

- Certificates: `apps/dokploy/components/dashboard/settings/certificates/show-certificates.tsx`
- Profile: `apps/dokploy/components/dashboard/settings/profile/profile-form.tsx`
- Web Server: `apps/dokploy/components/dashboard/settings/web-server.tsx`
- Application domains: `apps/dokploy/components/dashboard/application/domains/show-domains.tsx`

Canonical shell:

```tsx
<Card className="h-full w-full bg-sidebar p-2.5 rounded-xl max-w-5xl mx-auto">
  <div className="rounded-xl bg-background shadow-md">
    <CardHeader>…</CardHeader>
    <CardContent className="border-t py-6 space-y-…">…</CardContent>
  </div>
</Card>
```

Conventions:

- Title: `text-xl` + muted lucide icon (`size-6 text-muted-foreground`)
- Description: `CardDescription`, one short sentence
- Actions: header-right on `sm+`, full-width stacked on mobile
- Lists: `bg-sidebar` row chrome → inner `bg-background border` (certificates style) OR bordered `Table`
- Mono for tokens, IPs, hostnames; semantic badge colors (green/amber/red) already used in the app
- Components from `@/components/ui/*` and `@/components/shared/*` only — no new design kits

## Surfaces inventory

Redesign these when touching infra UI (emails are gone — skip):

| Surface | Path |
|---------|------|
| Domains page | `apps/dokploy/pages/dashboard/domains.tsx` |
| Zones grid | `apps/dokploy/components/dashboard/domains/cloudflare-zones-grid.tsx` |
| DNS preview dialog | `apps/dokploy/components/dashboard/domains/cloudflare-dns-preview-dialog.tsx` |
| CF settings card | `apps/dokploy/components/dashboard/settings/dns-providers/cloudflare-settings-card.tsx` |
| Domain CF controls | `apps/dokploy/components/dashboard/application/domains/cloudflare-domain-controls.tsx` |
| Domain CF sync dialog | `apps/dokploy/components/dashboard/application/domains/cloudflare-domain-sync-dialog.tsx` |
| Connection panel | `apps/dokploy/components/dashboard/application/domains/domain-connection-panel.tsx` |
| Add/edit domain CF bits | `apps/dokploy/components/dashboard/application/domains/handle-domain.tsx` |
| Show domains (CF mount) | `apps/dokploy/components/dashboard/application/domains/show-domains.tsx` |

Sidebar Domains entry (`side.tsx`): consistency only — do not redesign the whole sidebar.

## Do / don’t

### Cards
- **Do:** Outer `bg-sidebar` + inner `bg-background` shell for page-level panels; one primary Card per page section.
- **Don’t:** Nested decorative cards; purple gradients; glow; reinvent tokens.

### Tables & lists
- **Do:** Clear hostname/zone hierarchy; mono for DNS values; responsive (hide non-essential columns on `sm`).
- **Don’t:** Dense pill clusters or competing metadata rows.

### Empty / loading / error
- **Do:** Centered empty state with icon + one sentence + primary action; `Loader2` + short label; `AlertBlock` / destructive text for errors.
- **Don’t:** Skeleton forests or marketing empty illustrations.

### Modals / forms
- **Do:** `Dialog` / `AlertDialog` with clear title, one job, footer actions; keep tRPC wiring intact.
- **Don’t:** Change mutation contracts or recreate email flows.

### Motion
- **Do:** 2–3 subtle motions — e.g. `animate-in fade-in-0 slide-in-from-bottom-2`, staggered `delay-*` on rows, hover `transition-colors` / `hover:shadow-md`. Prefer Tailwind animate utilities already in the app.
- **Don’t:** Noisy perpetual animation, glow pulses, or emoji.

### Copy
- **Do:** Domains, Cloudflare DNS, zones, proxy, Traefik / Let’s Encrypt DNS-01 as relevant.
- **Don’t:** Mentions of mail, mailboxes, DKIM, or email hosting.

## Workflow

1. Read this skill + inspect one polished sibling page.
2. Inventory touched files from the table above.
3. Redesign presentation only — keep API/tRPC behavior.
4. Verify desktop + mobile layout and no broken imports.
5. Do not commit unless asked.

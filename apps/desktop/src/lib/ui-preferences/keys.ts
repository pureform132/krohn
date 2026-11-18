/**
 * Which persisted keys are machine-level UI preferences (#145213).
 *
 * Only these leave localStorage for the machine's shared store, so native
 * Desktop and every browser that opens this machine's Webapp show the same
 * choices. Scoped families keep their scope inside the key name (a
 * `….profile.<name>` or per-connection suffix): only the location changes.
 *
 * Deliberately NOT here (they stay in this browser/window):
 * - credentials, grants and connection config: gateway registry, custom model
 *   endpoints, plugin decisions and preview-script grants, embed permissions;
 * - per-window or per-device runtime state: layout tree, open tiles and tabs,
 *   last route/session, scroll, zoom, pet and popout geometry, keep-awake;
 * - drafts, queues, journals and caches: composer queue, in-flight turns,
 *   pending/prepared submissions, previews, pricing, backend skin cache, the
 *   "provider configured" onboarding cache (each backend answers that itself);
 * - one-off notices: butterbar, update and real-profile prompts.
 */

const SHARED_KEYS: ReadonlySet<string> = new Set([
  // Appearance.
  'krohn-desktop-theme-v2',
  'krohn-desktop-mode-v1',
  'krohn-desktop-profile-themes-v1',
  'krohn-desktop-profile-modes-v1',
  'krohn-desktop-user-themes-v1',
  'krohn.desktop.backdrop.v1',
  'krohn.desktop.chat-text-scale.v1',
  'krohn.desktop.interfaceMode.v1',
  'krohn.desktop.textDirection',
  'krohn.desktop.translucency.v2',
  'krohn.desktop.user-bubble-transparency.v1',
  // Sessions sidebar and profile rail.
  'krohn.desktop.agentsGroupedByWorkspace',
  'krohn.desktop.profileColors',
  'krohn.desktop.profileOrder',
  'krohn.desktop.profileRailVisible',
  'krohn.desktop.sessionListDensity',
  'krohn.desktop.sessionOrder',
  'krohn.desktop.sessionOrder.manual',
  'krohn.desktop.showAllProfiles',
  'krohn.desktop.sidebarAgentsGrouped.allProfiles',
  'krohn.desktop.sidebarCardRows',
  'krohn.desktop.sidebarGrouping',
  'krohn.desktop.sidebarGrouping.allProfiles',
  'krohn.desktop.sidebarRowMeta',
  'krohn.desktop.sidebarShowAllSessions',
  'krohn.desktop.sidebarShowArchived',
  'krohn.desktop.sidebarSortKey',
  // Status bar.
  'krohn.desktop.statusbarHidden.v2',
  'krohn.desktop.statusbarVisible.v2',
  // Transcript and tools.
  'krohn.desktop.hideThreadTimeline',
  'krohn.desktop.reasoning.collapsedByDefault',
  'krohn.desktop.toolView.hideCodeDiffs',
  'krohn.desktop.toolView.technical',
  // Shell, panes and behaviour.
  'krohn.desktop.alwaysExternalLinks.v1',
  'krohn.desktop.capabilities.catalogCardView',
  'krohn.desktop.composerPopout.enabled',
  'krohn.desktop.composerPopout.gesturesEnabled',
  'krohn.desktop.files.showIgnored',
  'krohn.desktop.keybinds',
  'krohn.desktop.layoutPresets.v2',
  'krohn.desktop.panesFlipped',
  'krohn.desktop.tabStripDefault',
  'krohn.desktop.titlebarAppActions',
  // Guidance: what the user already skipped, saw or dismissed does not come
  // back in every new browser or origin (#145600).
  'krohn-onboarding-skipped-v1',
  'krohn.desktop.tips.last.v1',
  'krohn.desktop.tips.next.v1',
  'krohn.desktop.tips.retired.v1',
  'krohn.desktop.tips.rotation.v1',
  'krohn.desktop.tips.shownAt.v1',
  'krohn.desktop.tours.v1',
  // Sound and media.
  'krohn.desktop.autoSpeakReplies',
  'krohn.desktop.completionSoundVariantId',
  'krohn.desktop.hapticsMuted',
  'krohn.desktop.videoPlaybackSpeed',
  // Model picker.
  'krohn.desktop.collapsed-providers',
  'krohn.desktop.favorite-models',
  // visible-models is a diff against known-models: they only make sense together.
  'krohn.desktop.known-models',
  'krohn.desktop.model-presets',
  'krohn.desktop.visible-models'
])

/** Families whose scope rides in the key suffix (gateway aliases/order/collapsed). */
const SHARED_PREFIXES: readonly string[] = ['krohn.desktop.sidebar.gatewayGroups.v1.']

export function isSharedPreferenceKey(key: string): boolean {
  return SHARED_KEYS.has(key) || SHARED_PREFIXES.some(prefix => key.startsWith(prefix))
}

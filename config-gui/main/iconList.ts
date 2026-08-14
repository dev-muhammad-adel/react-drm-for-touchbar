/**
 * Curated set of react-icons/fa6 icons the GUI can safely offer for a dock
 * app's fallback glyph (DockApp.icon). Fixed on purpose: picking one means
 * ts-morph adds it as a named import if config.ts doesn't already have it,
 * which only works for names we know are real exports of react-icons/fa6.
 */
export const ICON_CHOICES: readonly string[] = [
  'FaFolder', 'FaFolderOpen', 'FaTerminal', 'FaFirefoxBrowser', 'FaChrome',
  'FaCode', 'FaMusic', 'FaGithub', 'FaGitlab', 'FaGear', 'FaImage',
  'FaFile', 'FaFilePdf', 'FaEnvelope', 'FaCalendar', 'FaCamera',
  'FaVideo', 'FaDiscord', 'FaSlack', 'FaSpotify', 'FaSteam',
  'FaDocker', 'FaLinux', 'FaGlobe', 'FaDownload', 'FaPrint',
];

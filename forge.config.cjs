module.exports = {
  packagerConfig: {
    name: 'Blackstar Support Tool',
    executableName: 'blackstar-support',
    asar: true,
    // Place an icon.ico in src/renderer/assets/ to use a custom icon
    // icon: './src/renderer/assets/icon',
  },
  // Rebuild native modules automatically
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'BlackstarSupportTool',
        setupExe: 'BlackstarSupportTool-Setup.exe',
        description: 'Blackstar Support Tool - Secure Remote Support',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
  ],
};

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.githintz.glowcast',
  appName: 'Glowcast',
  webDir: 'dist',
  android: {
    // WebView console errors are surfaced in logcat so the CI smoke test can fail on them.
    loggingBehavior: 'debug',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_glowcast',
      iconColor: '#FF8A3D',
    },
  },
};

export default config;

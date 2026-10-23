import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.github.githintz.glowcast',
  appName: 'Glowcast',
  webDir: 'dist',
  android: {
    // WebView console output goes to logcat in release builds too, so the CI smoke test can fail on errors.
    loggingBehavior: 'production',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_glowcast',
      iconColor: '#FF8A3D',
    },
  },
};

export default config;

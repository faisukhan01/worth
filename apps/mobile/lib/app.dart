import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'config.dart';
import 'screens/home_shell.dart';
import 'screens/login_screen.dart';
import 'state/session.dart';

/// Lodestar palette: dark slate base, emerald/amber/rose status ramp.
abstract final class LodestarColors {
  static const Color background = Color(0xFF0B0F14);
  static const Color surface = Color(0xFF11161D);
  static const Color border = Color(0xFF1E2936);
  static const Color emerald = Color(0xFF10B981);
  static const Color amber = Color(0xFFF59E0B);
  static const Color rose = Color(0xFFF43F5E);
  static const Color textPrimary = Color(0xFFE6EDF3);
  static const Color textSecondary = Color(0xFF8B98A9);
  static const Color textFaint = Color(0xFF5B6878);
}

/// Builds the single dark theme used across the app (dark-only product).
ThemeData buildLodestarTheme() {
  const ColorScheme scheme = ColorScheme.dark(
    primary: LodestarColors.emerald,
    onPrimary: Color(0xFF05261A),
    secondary: LodestarColors.amber,
    onSecondary: Color(0xFF2A1B03),
    error: LodestarColors.rose,
    onError: Color(0xFF2B070E),
    surface: LodestarColors.surface,
    onSurface: LodestarColors.textPrimary,
    outline: LodestarColors.border,
    outlineVariant: LodestarColors.border,
  );

  OutlineInputBorder inputBorder() {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: const BorderSide(color: LodestarColors.border),
    );
  }

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    scaffoldBackgroundColor: LodestarColors.background,
    textTheme: const TextTheme(
      headlineSmall: TextStyle(
        fontWeight: FontWeight.w800,
        letterSpacing: -0.8,
        color: LodestarColors.textPrimary,
      ),
      titleLarge: TextStyle(
        fontWeight: FontWeight.w700,
        letterSpacing: -0.4,
        color: LodestarColors.textPrimary,
      ),
      titleMedium: TextStyle(fontWeight: FontWeight.w600, color: LodestarColors.textPrimary),
      bodyLarge: TextStyle(color: LodestarColors.textPrimary),
      bodyMedium: TextStyle(color: LodestarColors.textPrimary),
      bodySmall: TextStyle(color: LodestarColors.textSecondary),
      labelSmall: TextStyle(color: LodestarColors.textSecondary),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: LodestarColors.background,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.5,
        color: LodestarColors.textPrimary,
      ),
    ),
    cardTheme: CardTheme(
      color: LodestarColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: const BorderSide(color: LodestarColors.border),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: LodestarColors.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: LodestarColors.emerald.withOpacity(0.14),
      elevation: 0,
      height: 64,
      labelTextStyle: const WidgetStatePropertyAll<TextStyle>(
        TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: LodestarColors.textSecondary),
      ),
      iconTheme: const WidgetStatePropertyAll<IconThemeData>(
        IconThemeData(color: LodestarColors.textSecondary),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: LodestarColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: inputBorder(),
      enabledBorder: inputBorder(),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: LodestarColors.emerald, width: 1.4),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: LodestarColors.rose),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: LodestarColors.rose, width: 1.4),
      ),
      labelStyle: const TextStyle(color: LodestarColors.textSecondary, fontWeight: FontWeight.w500),
      hintStyle: const TextStyle(color: LodestarColors.textFaint),
      helperStyle: const TextStyle(color: LodestarColors.textFaint, fontSize: 11),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: LodestarColors.emerald,
      linearTrackColor: LodestarColors.border,
      circularTrackColor: LodestarColors.border,
    ),
    dividerTheme: const DividerThemeData(color: LodestarColors.border, thickness: 1, space: 1),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: LodestarColors.surface,
      contentTextStyle: const TextStyle(color: LodestarColors.textPrimary, fontSize: 13),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: const BorderSide(color: LodestarColors.border),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 46),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
      ),
    ),
  );
}

/// Application root: dark-only theme, named routes, login gate.
class LodestarApp extends StatelessWidget {
  const LodestarApp({super.key});

  @override
  Widget build(BuildContext context) {
    final bool signedIn =
        context.select<SessionStore, bool>((SessionStore session) => session.signedIn);
    return MaterialApp(
      title: 'Lodestar',
      debugShowCheckedModeBanner: false,
      theme: buildLodestarTheme(),
      darkTheme: buildLodestarTheme(),
      themeMode: ThemeMode.dark,
      initialRoute: signedIn ? LodestarRoutes.home : LodestarRoutes.login,
      onGenerateRoute: onGenerateRoute,
      onUnknownRoute: (RouteSettings settings) => _page(const LoginScreen(), settings),
    );
  }
}

/// Maps the named routes onto screens; deep links open the shell on a tab.
Route<dynamic>? onGenerateRoute(RouteSettings settings) {
  switch (settings.name) {
    case LodestarRoutes.login:
      return _page(const LoginScreen(), settings);
    case LodestarRoutes.home:
      return _page(const HomeShell(initialTab: HomeShell.tabHome), settings);
    case LodestarRoutes.incidents:
      return _page(const HomeShell(initialTab: HomeShell.tabIncidents), settings);
    case LodestarRoutes.insights:
      return _page(const HomeShell(initialTab: HomeShell.tabInsights), settings);
    case LodestarRoutes.settings:
      return _page(const HomeShell(initialTab: HomeShell.tabSettings), settings);
    default:
      return null;
  }
}

PageRoute<dynamic> _page(Widget child, RouteSettings settings) {
  return MaterialPageRoute<void>(
    settings: settings,
    builder: (BuildContext context) => child,
  );
}

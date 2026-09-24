import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../app.dart';
import '../state/live_data.dart';
import '../util/format.dart';
import '../widgets/live_dot.dart';
import 'home_screen.dart';
import 'incidents_screen.dart';
import 'insights_screen.dart';
import 'settings_screen.dart';

/// Bottom-navigation shell hosting the four primary tabs in an IndexedStack.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key, this.initialTab = HomeShell.tabHome});

  static const int tabHome = 0;
  static const int tabIncidents = 1;
  static const int tabInsights = 2;
  static const int tabSettings = 3;

  final int initialTab;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = HomeShell.tabHome;

  @override
  void initState() {
    super.initState();
    _tab = widget.initialTab;
    context.read<LiveDataStore>().start();
  }

  @override
  Widget build(BuildContext context) {
    final LiveDataStore live = context.watch<LiveDataStore>();
    final int openCount = live.insights?.summary.openAnomalies ?? 0;
    final Color dotColor = live.error == null ? LodestarColors.emerald : LodestarColors.rose;

    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            LiveDot(color: dotColor),
            const SizedBox(width: 10),
            const Text('Lodestar'),
          ],
        ),
        actions: <Widget>[
          if (live.lastUpdated != null)
            Padding(
              padding: const EdgeInsets.only(right: 4),
              child: Center(
                child: Text(
                  'Updated ${formatClock(live.lastUpdated!)}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ),
          IconButton(
            tooltip: 'Refresh now',
            onPressed: live.refresh,
            icon: const Icon(Icons.refresh),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: IndexedStack(
        index: _tab,
        children: const <Widget>[
          HomeScreen(),
          IncidentsScreen(),
          InsightsScreen(),
          SettingsScreen(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (int index) => setState(() => _tab = index),
        destinations: <Widget>[
          const NavigationDestination(
            icon: Icon(Icons.dashboard_outlined),
            selectedIcon: Icon(Icons.dashboard_rounded),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Badge.count(
              count: openCount,
              isLabelVisible: openCount > 0,
              child: const Icon(Icons.warning_amber_outlined),
            ),
            selectedIcon: Badge.count(
              count: openCount,
              isLabelVisible: openCount > 0,
              child: const Icon(Icons.warning_amber_rounded),
            ),
            label: 'Incidents',
          ),
          const NavigationDestination(
            icon: Icon(Icons.insights_outlined),
            selectedIcon: Icon(Icons.insights_rounded),
            label: 'Insights',
          ),
          const NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings_rounded),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}

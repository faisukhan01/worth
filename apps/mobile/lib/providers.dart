import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import 'api/lodestar_api.dart';
import 'state/live_data.dart';
import 'state/session.dart';

/// Root dependency wiring: session -> API client -> live data poller.
///
/// Wrap [child] once at bootstrap (see main.dart). The API client is rebuilt
/// internally whenever the session emits a change (new key or endpoints).
class LodestarProviders extends StatefulWidget {
  const LodestarProviders({super.key, required this.session, required this.child});

  final SessionStore session;
  final Widget child;

  @override
  State<LodestarProviders> createState() => _LodestarProvidersState();
}

class _LodestarProvidersState extends State<LodestarProviders> {
  late final LodestarApi _api;
  late final LiveDataStore _liveData;

  @override
  void initState() {
    super.initState();
    _api = LodestarApi(config: widget.session.config, apiKey: widget.session.apiKey);
    widget.session.addListener(_applySessionToApi);
    _liveData = LiveDataStore(api: _api);
  }

  void _applySessionToApi() {
    _api.configure(config: widget.session.config, apiKey: widget.session.apiKey);
  }

  @override
  void dispose() {
    widget.session.removeListener(_applySessionToApi);
    _liveData.dispose();
    _api.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: <SingleChildWidget>[
        ChangeNotifierProvider<SessionStore>.value(value: widget.session),
        Provider<LodestarApi>.value(value: _api),
        ChangeNotifierProvider<LiveDataStore>.value(value: _liveData),
      ],
      child: widget.child,
    );
  }
}

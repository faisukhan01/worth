import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../api/lodestar_api.dart';
import '../models/models.dart';

/// Polls the gateway and the AIOps engine on a fixed cadence, backing off
/// exponentially while the backend is unreachable.
class LiveDataStore extends ChangeNotifier {
  LiveDataStore({
    required LodestarApi api,
    this.pollInterval = const Duration(seconds: 5),
    this.maxBackoff = const Duration(seconds: 60),
  }) : _api = api;

  final LodestarApi _api;
  final Duration pollInterval;
  final Duration maxBackoff;

  Timer? _timer;
  bool _started = false;
  bool _polling = false;
  int _consecutiveErrors = 0;
  DateTime _nextAttemptAt = DateTime.fromMillisecondsSinceEpoch(0);

  GatewayStats? _stats;
  InsightBundle? _insights;
  DateTime? _lastUpdated;
  bool _isLoading = false;
  String? _error;
  final Set<String> _ackedAnomalyIds = <String>{};

  GatewayStats? get stats => _stats;
  InsightBundle? get insights => _insights;
  DateTime? get lastUpdated => _lastUpdated;
  bool get isLoading => _isLoading;
  String? get error => _error;

  bool isAcknowledged(String anomalyId) => _ackedAnomalyIds.contains(anomalyId);

  /// Marks an anomaly as acknowledged locally (device-only ack set).
  void acknowledge(String anomalyId) {
    if (_ackedAnomalyIds.add(anomalyId)) {
      notifyListeners();
    }
  }

  /// Starts the poll loop. Idempotent; clears the local ack set on (re)start.
  void start() {
    if (_started) {
      return;
    }
    _started = true;
    _ackedAnomalyIds.clear();
    _timer = Timer.periodic(pollInterval, (Timer _) => _tick());
    unawaited(refresh());
  }

  /// Stops the poll loop. Idempotent.
  void stop() {
    _timer?.cancel();
    _timer = null;
    _started = false;
  }

  /// Forces an immediate poll, bypassing the current backoff window.
  Future<void> refresh() => _tick(force: true);

  Future<void> _tick({bool force = false}) async {
    if (_polling) {
      return;
    }
    final DateTime now = DateTime.now();
    if (!force && now.isBefore(_nextAttemptAt)) {
      return;
    }
    _polling = true;
    final bool firstLoad = _stats == null || _insights == null;
    if (firstLoad || force) {
      _isLoading = true;
      notifyListeners();
    }
    try {
      final GatewayStats stats = await _api.stats();
      final InsightBundle insights = await _api.insights();
      _stats = stats;
      _insights = insights;
      _error = null;
      _consecutiveErrors = 0;
      _lastUpdated = DateTime.now();
    } on ApiException catch (e) {
      _consecutiveErrors += 1;
      _error = e.message;
      final int exponent = math.min(_consecutiveErrors - 1, 4);
      final Duration backoff = pollInterval * (1 << exponent);
      _nextAttemptAt = DateTime.now().add(backoff > maxBackoff ? maxBackoff : backoff);
    } finally {
      _polling = false;
      _isLoading = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}

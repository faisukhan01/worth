import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/lodestar_api.dart';
import '../app.dart';
import '../models/models.dart';
import '../state/live_data.dart';
import '../util/format.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_banner.dart';
import '../widgets/kpi_tile.dart';
import '../widgets/section_header.dart';
import '../widgets/sparkline.dart';
import '../widgets/status_pill.dart';

/// Fleet overview: KPI grid plus per-service health cards with sparklines.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  static const List<String> _metricNames = <String>['latency.p99', 'error.rate', 'request.rate'];
  static const Duration _metricsTtl = Duration(seconds: 30);
  static const int _sparklineWindow = 24;

  late final LiveDataStore _live;

  List<MetricSeries> _metrics = const <MetricSeries>[];
  DateTime? _metricsFetchedAt;
  DateTime? _lastLiveUpdate;
  bool _metricsLoading = false;
  String? _metricsError;

  @override
  void initState() {
    super.initState();
    _live = context.read<LiveDataStore>();
    _live.addListener(_onLiveChanged);
    _loadMetrics();
  }

  @override
  void dispose() {
    _live.removeListener(_onLiveChanged);
    super.dispose();
  }

  void _onLiveChanged() {
    final DateTime? updated = _live.lastUpdated;
    if (updated == _lastLiveUpdate) {
      return;
    }
    _lastLiveUpdate = updated;
    _loadMetrics();
  }

  Future<void> _loadMetrics({bool force = false}) async {
    if (_metricsLoading) {
      return;
    }
    final DateTime? fetchedAt = _metricsFetchedAt;
    if (!force && fetchedAt != null && DateTime.now().difference(fetchedAt) < _metricsTtl) {
      return;
    }
    _metricsLoading = true;
    if (mounted) {
      setState(() {});
    }
    try {
      final LodestarApi api = context.read<LodestarApi>();
      final List<MetricSeries> series =
          await api.metricSeries(names: _metricNames, range: '30m', points: 60);
      if (!mounted) {
        return;
      }
      setState(() {
        _metrics = series;
        _metricsError = null;
        _metricsFetchedAt = DateTime.now();
      });
    } on ApiException catch (e) {
      if (!mounted) {
        return;
      }
      setState(() {
        _metricsError = e.message;
        _metricsFetchedAt = DateTime.now();
      });
    } finally {
      _metricsLoading = false;
      if (mounted) {
        setState(() {});
      }
    }
  }

  /// Worst-case (max) latest value across all services for a metric name.
  double? _peakLatest(String name) {
    double? peak;
    for (final MetricSeries series in _metrics) {
      if (series.name != name) {
        continue;
      }
      final double? value = series.latestValue;
      if (value != null && (peak == null || value > peak)) {
        peak = value;
      }
    }
    return peak;
  }

  /// Recent request-rate samples for one service, for its sparkline.
  List<double> _sparklineFor(String service) {
    for (final MetricSeries series in _metrics) {
      if (series.name == 'request.rate' && series.service == service) {
        final List<MetricPoint> points = series.points;
        final int start = points.length > _sparklineWindow ? points.length - _sparklineWindow : 0;
        return <double>[for (final MetricPoint point in points.sublist(start)) point.value];
      }
    }
    return const <double>[];
  }

  @override
  Widget build(BuildContext context) {
    final LiveDataStore live = context.watch<LiveDataStore>();
    final GatewayStats? stats = live.stats;
    final InsightBundle? insights = live.insights;
    final bool firstLoad = live.isLoading && stats == null && insights == null;

    final List<ServiceHealth> health =
        List<ServiceHealth>.of(insights?.health ?? const <ServiceHealth>[])
          ..sort((ServiceHealth a, ServiceHealth b) => a.score.compareTo(b.score));

    Widget body;
    if (firstLoad) {
      body = const SliverFillRemaining(
        hasScrollBody: false,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    } else if (stats == null && insights == null) {
      body = SliverFillRemaining(
        hasScrollBody: false,
        child: EmptyState(
          icon: Icons.satellite_outlined,
          title: live.error == null ? 'Waiting for first poll' : 'Connection problem',
          message: live.error ?? 'The overview fills in as soon as the gateway responds.',
          actionLabel: 'Retry now',
          onAction: live.refresh,
        ),
      );
    } else {
      body = _buildContent(live, stats, health);
    }

    return RefreshIndicator(
      onRefresh: () async {
        await Future.wait(<Future<void>>[live.refresh(), _loadMetrics(force: true)]);
      },
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: <Widget>[
          const SliverAppBar(pinned: true, title: Text('Overview')),
          if (live.error != null && !firstLoad)
            SliverToBoxAdapter(child: ErrorBanner(message: live.error!, onRetry: live.refresh)),
          body,
        ],
      ),
    );
  }

  Widget _buildContent(LiveDataStore live, GatewayStats? stats, List<ServiceHealth> health) {
    final double? p99 = _peakLatest('latency.p99');
    final double? errorRate = _peakLatest('error.rate');

    return SliverList(
      delegate: SliverChildListDelegate(<Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: _StatStrip(stats: stats),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: GridView.count(
            crossAxisCount: 2,
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 1.6,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            padding: EdgeInsets.zero,
            children: <Widget>[
              KpiTile(
                label: 'requests / sec',
                value: stats == null ? '--' : formatCompact(stats.requestsPerSecond),
                icon: Icons.bolt_rounded,
              ),
              KpiTile(
                label: 'p99 latency',
                value: p99 == null ? '--' : '${formatLatency(p99)} ms',
                icon: Icons.speed_rounded,
                accent: LodestarColors.amber,
              ),
              KpiTile(
                label: 'error rate',
                value: errorRate == null ? '--' : formatRatePercent(errorRate),
                icon: Icons.error_outline_rounded,
                accent: LodestarColors.rose,
              ),
              KpiTile(
                label: 'agents connected',
                value: stats == null ? '--' : formatCount(stats.agentsConnected),
                icon: Icons.sensors_rounded,
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: SectionHeader(
            title: 'Service health',
            trailing: Text(
              '${health.length} services',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
        ),
        if (_metricsError != null) ErrorBanner(message: _metricsError!),
        for (final ServiceHealth service in health)
          _ServiceHealthCard(health: service, sparkline: _sparklineFor(service.service)),
        if (health.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 32),
            child: EmptyState(
              icon: Icons.monitor_heart_outlined,
              title: 'No services yet',
              message: 'Service health appears once the AIOps engine reports in.',
            ),
          ),
        if (_metricsLoading)
          const Padding(
            padding: EdgeInsets.all(14),
            child: Center(
              child: SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          ),
        const SizedBox(height: 24),
      ]),
    );
  }
}

class _StatStrip extends StatelessWidget {
  const _StatStrip({required this.stats});

  final GatewayStats? stats;

  @override
  Widget build(BuildContext context) {
    final GatewayStats? value = stats;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: <Widget>[
          _MiniStat(label: 'uptime', value: value == null ? '--' : formatUptime(value.uptimeSeconds)),
          const SizedBox(width: 8),
          _MiniStat(label: 'logs / min', value: value == null ? '--' : formatCompact(value.logsPerMinute)),
          const SizedBox(width: 8),
          _MiniStat(label: 'active series', value: value == null ? '--' : formatCompact(value.seriesActive)),
        ],
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: LodestarColors.surface,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: LodestarColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            value,
            style: const TextStyle(
              fontWeight: FontWeight.w700,
              fontSize: 12,
              color: LodestarColors.textPrimary,
            ),
          ),
          const SizedBox(width: 6),
          Text(label, style: const TextStyle(fontSize: 11, color: LodestarColors.textFaint)),
        ],
      ),
    );
  }
}

class _ServiceHealthCard extends StatelessWidget {
  const _ServiceHealthCard({required this.health, required this.sparkline});

  final ServiceHealth health;
  final List<double> sparkline;

  @override
  Widget build(BuildContext context) {
    final Color statusColor = healthStatusColor(health.status);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: LodestarColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: LodestarColors.border),
        ),
        child: Row(
          children: <Widget>[
            Container(
              width: 10,
              height: 10,
              decoration: BoxDecoration(
                color: statusColor,
                shape: BoxShape.circle,
                boxShadow: <BoxShadow>[
                  BoxShadow(color: statusColor.withOpacity(0.35), blurRadius: 6, spreadRadius: 1),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    health.service,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      color: LodestarColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: <Widget>[
                      Text(
                        'score ${health.score.toStringAsFixed(0)}',
                        style: const TextStyle(fontSize: 12, color: LodestarColors.textSecondary),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        healthStatusLabel(health.status),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: statusColor,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 12),
            SizedBox(width: 96, height: 34, child: Sparkline(values: sparkline, color: statusColor)),
          ],
        ),
      ),
    );
  }
}

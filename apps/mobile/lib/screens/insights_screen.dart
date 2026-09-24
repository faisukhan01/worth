import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../app.dart';
import '../models/models.dart';
import '../state/live_data.dart';
import '../util/format.dart';
import '../widgets/empty_state.dart';
import '../widgets/error_banner.dart';
import '../widgets/section_header.dart';
import '../widgets/status_pill.dart';

/// AIOps posture: overall fleet status, anomaly confidence list, forecasts.
class InsightsScreen extends StatefulWidget {
  const InsightsScreen({super.key});

  @override
  State<InsightsScreen> createState() => _InsightsScreenState();
}

class _InsightsScreenState extends State<InsightsScreen> {
  String? _selectedForecast;

  @override
  Widget build(BuildContext context) {
    final LiveDataStore live = context.watch<LiveDataStore>();
    final InsightBundle? bundle = live.insights;

    if (bundle == null) {
      if (live.isLoading) {
        return const Center(child: CircularProgressIndicator(strokeWidth: 2));
      }
      return Center(
        child: EmptyState(
          icon: Icons.query_stats,
          title: 'No insights yet',
          message: live.error ?? 'Insights appear after the first successful sync.',
          actionLabel: live.error == null ? null : 'Retry now',
          onAction: live.error == null ? null : live.refresh,
        ),
      );
    }

    final List<Anomaly> anomalies = List<Anomaly>.of(bundle.anomalies)
      ..sort((Anomaly a, Anomaly b) => b.startedAt.compareTo(a.startedAt));
    final List<Forecast> forecasts = bundle.forecasts;
    final List<String> forecastKeys = <String>[for (final Forecast f in forecasts) f.series];
    final bool selectionValid = _selectedForecast != null && forecastKeys.contains(_selectedForecast);
    final String? selectedKey = selectionValid
        ? _selectedForecast
        : (forecastKeys.isNotEmpty ? forecastKeys.first : null);
    final Forecast? selected = selectedKey == null
        ? null
        : forecasts.firstWhere(
            (Forecast f) => f.series == selectedKey,
            orElse: () => forecasts.first,
          );

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: <Widget>[
        if (live.error != null) ErrorBanner(message: live.error!, onRetry: live.refresh),
        _FleetStatusCard(summary: bundle.summary),
        const SizedBox(height: 20),
        SectionHeader(
          title: 'Anomalies',
          trailing: Text('${bundle.anomalies.length}', style: Theme.of(context).textTheme.bodySmall),
        ),
        if (anomalies.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Text(
              'No anomalies detected in the current window.',
              style: TextStyle(fontSize: 13, color: LodestarColors.textFaint),
            ),
          )
        else
          for (final Anomaly anomaly in anomalies) ...<Widget>[
            _AnomalyRow(anomaly: anomaly, acknowledged: live.isAcknowledged(anomaly.id)),
            const SizedBox(height: 10),
          ],
        const SizedBox(height: 20),
        SectionHeader(
          title: 'Forecasts',
          trailing: Text(
            forecasts.isEmpty ? 'none' : '${forecasts.length} series',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        if (selected == null)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: EmptyState(
              icon: Icons.timeline,
              title: 'No forecasts yet',
              message: 'The engine publishes forecasts once enough history exists.',
            ),
          )
        else ...<Widget>[
          DropdownButtonFormField<String>(
            value: selected.series,
            isExpanded: true,
            decoration: const InputDecoration(labelText: 'Forecast series'),
            items: <DropdownMenuItem<String>>[
              for (final String key in forecastKeys)
                DropdownMenuItem<String>(
                  value: key,
                  child: Text(
                    key,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13),
                  ),
                ),
            ],
            onChanged: (String? value) => setState(() => _selectedForecast = value),
          ),
          const SizedBox(height: 12),
          _ForecastChart(forecast: selected),
        ],
      ],
    );
  }
}

class _FleetStatusCard extends StatelessWidget {
  const _FleetStatusCard({required this.summary});

  final InsightSummary summary;

  Color get _statusColor {
    switch (summary.overallStatus.toLowerCase()) {
      case 'healthy':
      case 'ok':
      case 'nominal':
        return LodestarColors.emerald;
      case 'critical':
      case 'crit':
        return LodestarColors.rose;
      case 'degraded':
      case 'warning':
      case 'warn':
        return LodestarColors.amber;
      default:
        return LodestarColors.textSecondary;
    }
  }

  @override
  Widget build(BuildContext context) {
    final Color statusColor = _statusColor;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: LodestarColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: statusColor.withOpacity(0.35)),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Text(
                  'FLEET STATUS',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 1.2,
                    color: LodestarColors.textFaint,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  summary.overallStatus.toUpperCase(),
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.5,
                    color: statusColor,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'synced from the AIOps engine',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              _SummaryStat(value: '${summary.servicesMonitored}', label: 'services'),
              const SizedBox(height: 8),
              _SummaryStat(value: '${summary.openAnomalies}', label: 'open'),
            ],
          ),
        ],
      ),
    );
  }
}

class _SummaryStat extends StatelessWidget {
  const _SummaryStat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          value,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: LodestarColors.textPrimary,
          ),
        ),
        Text(label, style: const TextStyle(fontSize: 11, color: LodestarColors.textFaint)),
      ],
    );
  }
}

class _AnomalyRow extends StatelessWidget {
  const _AnomalyRow({required this.anomaly, required this.acknowledged});

  final Anomaly anomaly;
  final bool acknowledged;

  @override
  Widget build(BuildContext context) {
    final Color color = severityColor(anomaly.severity);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: LodestarColors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: LodestarColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              StatusPill(label: anomaly.severity, color: color, dense: true),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${anomaly.service} - ${anomaly.metric}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                ),
              ),
              if (acknowledged) ...<Widget>[
                const SizedBox(width: 8),
                const StatusPill(label: 'acked', color: LodestarColors.textSecondary, dense: true),
              ],
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: <Widget>[
              const Text(
                'confidence',
                style: TextStyle(fontSize: 11, color: LodestarColors.textFaint),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: clamp01(anomaly.confidence),
                    minHeight: 5,
                    backgroundColor: LodestarColors.border,
                    color: color,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '${(clamp01(anomaly.confidence) * 100).round()}%',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _ForecastChart extends StatelessWidget {
  const _ForecastChart({required this.forecast});

  final Forecast forecast;

  @override
  Widget build(BuildContext context) {
    final List<MetricPoint> points = forecast.points;
    if (points.length < 2) {
      return const EmptyState(
        icon: Icons.timeline,
        title: 'Not enough data',
        message: 'The engine did not return a usable forecast window.',
      );
    }

    final List<FlSpot> spots = <FlSpot>[
      for (final MetricPoint point in points) FlSpot(point.ts.toDouble(), point.value),
    ];

    double minX = spots.first.x;
    double maxX = spots.last.x;
    double minY = spots.first.y;
    double maxY = spots.first.y;
    for (final FlSpot spot in spots) {
      if (spot.y < minY) {
        minY = spot.y;
      }
      if (spot.y > maxY) {
        maxY = spot.y;
      }
    }
    if (maxX - minX < 1) {
      maxX = minX + 60000;
    }
    if (maxY - minY < 1e-9) {
      minY -= 1;
      maxY += 1;
    }
    final double yPadding = (maxY - minY) * 0.12;
    final double bottomY = minY - yPadding;
    final double topY = maxY + yPadding;
    final double yInterval = (topY - bottomY) / 3;
    final double xInterval = (maxX - minX) / 4;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: LodestarColors.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: LodestarColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  forecast.series,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                ),
              ),
              const StatusPill(label: 'projected', color: LodestarColors.amber, dense: true),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 210,
            child: LineChart(
              LineChartData(
                minX: minX,
                maxX: maxX,
                minY: bottomY,
                maxY: topY,
                gridData: FlGridData(
                  show: true,
                  drawVerticalLine: false,
                  horizontalInterval: yInterval,
                  getDrawingHorizontalLine: (double value) =>
                      const FlLine(color: LodestarColors.border, strokeWidth: 1),
                ),
                titlesData: FlTitlesData(
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 26,
                      interval: xInterval,
                      getTitlesWidget: (double value, _) => Padding(
                        padding: const EdgeInsets.only(top: 6),
                        child: Text(
                          _clockLabel(value),
                          style: const TextStyle(fontSize: 10, color: LodestarColors.textFaint),
                        ),
                      ),
                    ),
                  ),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 44,
                      interval: yInterval,
                      getTitlesWidget: (double value, _) => Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: Text(
                          formatCompact(value),
                          textAlign: TextAlign.right,
                          style: const TextStyle(fontSize: 10, color: LodestarColors.textFaint),
                        ),
                      ),
                    ),
                  ),
                ),
                borderData: FlBorderData(show: false),
                lineBarsData: <LineChartBarData>[
                  LineChartBarData(
                    spots: spots,
                    isCurved: true,
                    preventCurveOverShooting: true,
                    color: LodestarColors.amber,
                    barWidth: 2,
                    isStrokeCapRound: true,
                    dotData: const FlDotData(show: false),
                    belowBarData: BarAreaData(
                      show: true,
                      color: LodestarColors.amber.withOpacity(0.10),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            _caption(forecast),
            style: const TextStyle(fontSize: 11, color: LodestarColors.textFaint),
          ),
        ],
      ),
    );
  }

  static String _clockLabel(double millis) =>
      DateFormat.Hm().format(DateTime.fromMillisecondsSinceEpoch(millis.round()));

  static String _caption(Forecast forecast) {
    final String horizon =
        forecast.horizonMinutes == null ? '' : ' next ${forecast.horizonMinutes} min';
    final List<String> scope = <String>[
      if (forecast.service != null) 'service ${forecast.service}',
      if (forecast.metric != null) 'metric ${forecast.metric}',
    ];
    final String suffix = scope.isEmpty ? '' : ' (${scope.join(', ')})';
    return 'Projected$horizon by the AIOps engine$suffix.';
  }
}

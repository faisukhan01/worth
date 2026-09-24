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

/// AIOps anomaly queue with a detail bottom sheet and local acknowledgement.
class IncidentsScreen extends StatelessWidget {
  const IncidentsScreen({super.key});

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
          icon: Icons.shield_outlined,
          title: 'No incidents yet',
          message: live.error ?? 'Anomaly detection starts as soon as the AIOps engine responds.',
          actionLabel: live.error == null ? null : 'Retry now',
          onAction: live.error == null ? null : live.refresh,
        ),
      );
    }

    final List<Anomaly> anomalies = List<Anomaly>.of(bundle.anomalies)
      ..sort((Anomaly a, Anomaly b) => _compare(live, a, b));
    final int openCount = anomalies.where((Anomaly a) => !live.isAcknowledged(a.id)).length;

    if (anomalies.isEmpty) {
      return Center(
        child: EmptyState(
          icon: Icons.verified_outlined,
          title: 'All clear',
          message:
              'No anomalies across ${bundle.summary.servicesMonitored} monitored services.',
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: <Widget>[
        if (live.error != null) ErrorBanner(message: live.error!, onRetry: live.refresh),
        SectionHeader(
          title: 'Open incidents',
          trailing: Text(
            '$openCount open',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        for (final Anomaly anomaly in anomalies) ...<Widget>[
          _AnomalyCard(
            anomaly: anomaly,
            acknowledged: live.isAcknowledged(anomaly.id),
            onOpen: () => _openDetail(context, anomaly),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }

  void _openDetail(BuildContext context, Anomaly anomaly) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: LodestarColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (BuildContext sheetContext) => _AnomalyDetailSheet(anomaly: anomaly),
    );
  }
}

/// Unacknowledged first, then newest first.
int _compare(LiveDataStore live, Anomaly a, Anomaly b) {
  final bool aAcked = live.isAcknowledged(a.id);
  final bool bAcked = live.isAcknowledged(b.id);
  if (aAcked != bAcked) {
    return aAcked ? 1 : -1;
  }
  return b.startedAt.compareTo(a.startedAt);
}

class _AnomalyCard extends StatelessWidget {
  const _AnomalyCard({
    required this.anomaly,
    required this.acknowledged,
    required this.onOpen,
  });

  final Anomaly anomaly;
  final bool acknowledged;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final Color severity = severityColor(anomaly.severity);
    return Material(
      color: LodestarColors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onOpen,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: LodestarColors.border),
          ),
          child: IntrinsicHeight(
            child: Row(
              children: <Widget>[
                Container(
                  width: 4,
                  decoration: BoxDecoration(
                    color: severity,
                    borderRadius: const BorderRadius.horizontal(left: Radius.circular(14)),
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Row(
                          children: <Widget>[
                            StatusPill(label: anomaly.severity, color: severity),
                            const Spacer(),
                            Text(
                              formatRelativeTime(anomaly.startedAt),
                              style: const TextStyle(
                                fontSize: 12,
                                color: LodestarColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Text(
                          '${anomaly.service} - ${anomaly.metric}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            color: LodestarColors.textPrimary,
                          ),
                        ),
                        if (anomaly.message.isNotEmpty) ...<Widget>[
                          const SizedBox(height: 4),
                          Text(
                            anomaly.message,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12.5,
                              color: LodestarColors.textSecondary,
                            ),
                          ),
                        ],
                        const SizedBox(height: 10),
                        Row(
                          children: <Widget>[
                            Text(
                              'confidence ${(clamp01(anomaly.confidence) * 100).round()}%',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w600,
                                color: severity,
                              ),
                            ),
                            const Spacer(),
                            if (acknowledged)
                              const StatusPill(
                                label: 'acked',
                                color: LodestarColors.textSecondary,
                                dense: true,
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AnomalyDetailSheet extends StatelessWidget {
  const _AnomalyDetailSheet({required this.anomaly});

  final Anomaly anomaly;

  @override
  Widget build(BuildContext context) {
    final LiveDataStore live = context.watch<LiveDataStore>();
    Anomaly current = anomaly;
    final List<Anomaly> all = live.insights?.anomalies ?? const <Anomaly>[];
    for (final Anomaly candidate in all) {
      if (candidate.id == anomaly.id) {
        current = candidate;
        break;
      }
    }
    final bool acknowledged = live.isAcknowledged(current.id);
    final Color severity = severityColor(current.severity);
    final bool worse = current.baseline > 0 && current.observed > current.baseline;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: LodestarColors.border,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: <Widget>[
                StatusPill(label: current.severity, color: severity),
                const Spacer(),
                Text(
                  DateFormat('MMM d, HH:mm').format(current.startedAt),
                  style: const TextStyle(fontSize: 12, color: LodestarColors.textSecondary),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text('${current.service} - ${current.metric}', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 4),
            Text(
              'series: ${current.series}',
              style: const TextStyle(fontSize: 11, color: LodestarColors.textFaint),
            ),
            if (current.message.isNotEmpty) ...<Widget>[
              const SizedBox(height: 10),
              Text(
                current.message,
                style: const TextStyle(
                  fontSize: 13.5,
                  color: LodestarColors.textSecondary,
                  height: 1.45,
                ),
              ),
            ],
            const SizedBox(height: 16),
            Row(
              children: <Widget>[
                Expanded(child: _ValueBox(label: 'baseline', value: _formatValue(current.metric, current.baseline))),
                const SizedBox(width: 10),
                Expanded(
                  child: _ValueBox(
                    label: 'observed',
                    value: _formatValue(current.metric, current.observed),
                    accent: worse ? LodestarColors.rose : LodestarColors.emerald,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              _deltaLine(current),
              style: const TextStyle(fontSize: 12, color: LodestarColors.textFaint),
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: LodestarColors.amber.withOpacity(0.08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: LodestarColors.amber.withOpacity(0.35)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  const Icon(Icons.lightbulb_outline, size: 16, color: LodestarColors.amber),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        const Text(
                          'RECOMMENDED ACTION',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.8,
                            color: LodestarColors.amber,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _recommendedAction(current),
                          style: const TextStyle(
                            fontSize: 12.5,
                            color: LodestarColors.textPrimary,
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: acknowledged
                  ? OutlinedButton.icon(
                      onPressed: null,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: LodestarColors.textSecondary,
                        side: const BorderSide(color: LodestarColors.border),
                      ),
                      icon: const Icon(Icons.check_circle_outline),
                      label: const Text('Acknowledged'),
                    )
                  : FilledButton.icon(
                      onPressed: () {
                        context.read<LiveDataStore>().acknowledge(current.id);
                        Navigator.of(context).pop();
                      },
                      icon: const Icon(Icons.check_circle_outline),
                      label: const Text('Acknowledge'),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  static String _deltaLine(Anomaly anomaly) {
    final String confidence = 'confidence ${(clamp01(anomaly.confidence) * 100).round()}%';
    if (anomaly.baseline <= 0) {
      return '$confidence - score ${anomaly.score.toStringAsFixed(2)}';
    }
    final double change = (anomaly.observed - anomaly.baseline) / anomaly.baseline * 100;
    final String sign = anomaly.observed >= anomaly.baseline ? '+' : '';
    return '$sign${change.toStringAsFixed(1)}% vs baseline - $confidence - score ${anomaly.score.toStringAsFixed(2)}';
  }

  static String _formatValue(String metric, double value) {
    final String m = metric.toLowerCase();
    if (m.contains('latency')) {
      return '${formatLatency(value)} ms';
    }
    if (m.contains('error')) {
      return formatRatePercent(value);
    }
    if (m.contains('rate')) {
      return formatCompact(value);
    }
    return value.toStringAsFixed(2);
  }

  static String _recommendedAction(Anomaly anomaly) {
    final String metric = anomaly.metric.toLowerCase();
    final String service = anomaly.service;
    if (metric.contains('latency')) {
      return 'Inspect slow traces and upstream dependency latency for $service; '
          'check the most recent deploy before considering a rollback.';
    }
    if (metric.contains('error')) {
      return 'Triage the newest error logs for $service and correlate the spike '
          'with the last configuration or release change.';
    }
    if (metric.contains('request') || metric.contains('traffic')) {
      return 'Verify autoscaling headroom for $service and confirm the traffic '
          'source is expected before scaling further.';
    }
    return 'Review the $service dashboard, confirm the regression with the '
        'owning team, and record the mitigation in the incident notes.';
  }
}

class _ValueBox extends StatelessWidget {
  const _ValueBox({required this.label, required this.value, this.accent = LodestarColors.textPrimary});

  final String label;
  final String value;
  final Color accent;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: LodestarColors.background,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: LodestarColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.8,
              color: LodestarColors.textFaint,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: accent),
          ),
        ],
      ),
    );
  }
}

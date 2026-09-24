import 'package:flutter/material.dart';

import '../app.dart';
import '../models/models.dart';

/// Rounded status chip with a colored dot, used across screens.
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.color, this.dense = false});

  final String label;
  final Color color;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 7 : 9, vertical: dense ? 2 : 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 5),
          Text(
            label.toUpperCase(),
            style: TextStyle(
              fontSize: dense ? 10 : 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

/// Status ramp: emerald healthy, amber degraded, rose critical.
Color healthStatusColor(HealthStatus status) {
  switch (status) {
    case HealthStatus.healthy:
      return LodestarColors.emerald;
    case HealthStatus.degraded:
      return LodestarColors.amber;
    case HealthStatus.critical:
      return LodestarColors.rose;
  }
}

/// Human label for a [HealthStatus].
String healthStatusLabel(HealthStatus status) {
  switch (status) {
    case HealthStatus.healthy:
      return 'Healthy';
    case HealthStatus.degraded:
      return 'Degraded';
    case HealthStatus.critical:
      return 'Critical';
  }
}

/// Maps an AIOps severity string onto the palette; unknown values stay neutral.
Color severityColor(String severity) {
  switch (severity.toLowerCase()) {
    case 'critical':
    case 'crit':
    case 'sev1':
    case 'high':
      return LodestarColors.rose;
    case 'warning':
    case 'warn':
    case 'elevated':
    case 'medium':
      return LodestarColors.amber;
    default:
      return LodestarColors.textSecondary;
  }
}

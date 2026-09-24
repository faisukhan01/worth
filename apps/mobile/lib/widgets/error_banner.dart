import 'package:flutter/material.dart';

import '../app.dart';

/// Inline error surface with an optional retry action.
class ErrorBanner extends StatelessWidget {
  const ErrorBanner({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: LodestarColors.rose.withOpacity(0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: LodestarColors.rose.withOpacity(0.4)),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.error_outline, size: 16, color: LodestarColors.rose),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(
                fontSize: 12.5,
                color: LodestarColors.textPrimary,
                height: 1.4,
              ),
            ),
          ),
          if (onRetry != null)
            TextButton(
              onPressed: onRetry,
              style: TextButton.styleFrom(
                foregroundColor: LodestarColors.rose,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: const Size(0, 32),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: const Text('Retry'),
            ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../app.dart';
import '../config.dart';
import '../state/live_data.dart';
import '../state/session.dart';
import '../util/format.dart';
import '../widgets/section_header.dart';

/// Endpoint configuration, API key management, about and sign out.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  static const String appVersion = '0.1.0';

  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  late final TextEditingController _gatewayCtrl;
  late final TextEditingController _aiopsCtrl;
  late final SessionStore _session;
  bool _revealKey = false;

  @override
  void initState() {
    super.initState();
    _session = context.read<SessionStore>();
    _gatewayCtrl = TextEditingController(text: _session.gatewayBaseUrl);
    _aiopsCtrl = TextEditingController(text: _session.aiopsBaseUrl);
  }

  @override
  void dispose() {
    _gatewayCtrl.dispose();
    _aiopsCtrl.dispose();
    super.dispose();
  }

  Future<void> _saveEndpoints() async {
    if (!(_formKey.currentState?.validate() ?? false)) {
      return;
    }
    final bool gatewayOk = await _session.setGatewayBaseUrl(_gatewayCtrl.text);
    final bool aiopsOk = await _session.setAiopsBaseUrl(_aiopsCtrl.text);
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          gatewayOk && aiopsOk ? 'Endpoints saved.' : 'One or more endpoints were rejected.',
        ),
      ),
    );
  }

  Future<void> _copyApiKey() async {
    final String? key = _session.apiKey;
    if (key == null) {
      return;
    }
    await Clipboard.setData(ClipboardData(text: key));
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('API key copied to clipboard.')),
    );
  }

  void _signOut() {
    context.read<LiveDataStore>().stop();
    _session.signOut();
    Navigator.of(context).pushNamedAndRemoveUntil(
      LodestarRoutes.login,
      (Route<dynamic> route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    final SessionStore session = context.watch<SessionStore>();
    final String? key = session.apiKey;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: <Widget>[
        const SectionHeader(title: 'Endpoints'),
        Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              TextFormField(
                controller: _gatewayCtrl,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: 'Gateway base URL',
                  helperText: 'Go ingest gateway, default http://10.0.2.2:3100',
                ),
                validator: (String? value) =>
                    AppConfig.normalizeBaseUrl(value ?? '') == null ? 'Enter a valid http(s) URL.' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _aiopsCtrl,
                keyboardType: TextInputType.url,
                decoration: const InputDecoration(
                  labelText: 'AIOps base URL',
                  helperText: 'Python insights engine, default http://10.0.2.2:3200',
                ),
                validator: (String? value) =>
                    AppConfig.normalizeBaseUrl(value ?? '') == null ? 'Enter a valid http(s) URL.' : null,
              ),
              const SizedBox(height: 12),
              FilledButton.tonal(onPressed: _saveEndpoints, child: const Text('Save endpoints')),
            ],
          ),
        ),
        const SizedBox(height: 24),
        const SectionHeader(title: 'Authentication'),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: LodestarColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: LodestarColors.border),
          ),
          child: Row(
            children: <Widget>[
              const Icon(Icons.key_outlined, size: 18, color: LodestarColors.textSecondary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text(
                      'API key',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.8,
                        color: LodestarColors.textFaint,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      key == null ? 'Not signed in' : (_revealKey ? key : maskApiKey(key)),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 13, color: LodestarColors.textPrimary),
                    ),
                  ],
                ),
              ),
              if (key != null) ...<Widget>[
                IconButton(
                  tooltip: _revealKey ? 'Hide API key' : 'Reveal API key',
                  onPressed: () => setState(() => _revealKey = !_revealKey),
                  icon: Icon(
                    _revealKey ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                    size: 18,
                    color: LodestarColors.textSecondary,
                  ),
                ),
                IconButton(
                  tooltip: 'Copy API key',
                  onPressed: _copyApiKey,
                  icon: const Icon(Icons.copy_outlined, size: 18, color: LodestarColors.textSecondary),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 24),
        const SectionHeader(title: 'About'),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: LodestarColors.surface,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: LodestarColors.border),
          ),
          child: Row(
            children: <Widget>[
              const Icon(Icons.info_outline, size: 18, color: LodestarColors.textSecondary),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    const Text(
                      'Lodestar Mobile',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Version $appVersion - on-call companion for the Lodestar observability platform.',
                      style: const TextStyle(fontSize: 12, color: LodestarColors.textSecondary),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        FilledButton.tonalIcon(
          onPressed: _signOut,
          style: FilledButton.styleFrom(
            foregroundColor: LodestarColors.rose,
            backgroundColor: LodestarColors.rose.withOpacity(0.08),
            side: BorderSide(color: LodestarColors.rose.withOpacity(0.4)),
          ),
          icon: const Icon(Icons.logout),
          label: const Text('Sign out'),
        ),
      ],
    );
  }
}

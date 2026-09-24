import 'package:flutter/material.dart';

import 'app.dart';
import 'providers.dart';
import 'state/session.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final SessionStore session = SessionStore();
  await session.load();
  runApp(LodestarProviders(session: session, child: const LodestarApp()));
}

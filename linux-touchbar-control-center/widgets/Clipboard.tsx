import React, { useEffect, useState } from 'react';
import { Box, Text } from 'react-drm';
import { FaClipboard } from 'react-icons/fa';
import { execFile } from 'child_process';

const POLL_MS = 2_000;
const MAX_LEN = 30;

function readClipboard(): Promise<string> {
  return new Promise<string>((resolve) => {
    const sudoUser = process.env.SUDO_USER;
    const sudoUid = process.env.SUDO_UID;
    const uid = typeof process.getuid === 'function' ? process.getuid() : 1000;

    if (uid === 0 && sudoUser && sudoUid) {
      const runtimeDir = `/run/user/${sudoUid}`;
      const env = [
        `XDG_RUNTIME_DIR=${runtimeDir}`,
        `DBUS_SESSION_BUS_ADDRESS=unix:path=${runtimeDir}/bus`,
        `DISPLAY=${process.env.DISPLAY ?? ':0'}`,
      ];
      const wayland = process.env.WAYLAND_DISPLAY;
      if (wayland) env.push(`WAYLAND_DISPLAY=${wayland}`);

      execFile('runuser', ['-u', sudoUser, '--', 'env', ...env, 'npx', 'clipboardy'],
        { timeout: 3000 }, (err, stdout) => {
          resolve(err ? '' : stdout.trim());
        });
    } else {
      execFile('npx', ['clipboardy'], { timeout: 3000 }, (err, stdout) => {
        resolve(err ? '' : stdout.trim());
      });
    }
  });
}

export function Clipboard() {
  const [text, setText] = useState('');

  useEffect(() => {
    let active = true;
    const poll = () => {
      readClipboard().then(t => { if (active) setText(t); });
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { active = false; clearInterval(id); };
  }, []);

  const display = text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '...' : text;

  return (
    <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <Box style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
        <FaClipboard style={{ width: 14, height: 14 }} fill="#94a3b8" stroke="none" />
      </Box>
      <Text style={{ color: '#e5e7eb', fontSize: 13 }}>
        {display || 'Empty'}
      </Text>
    </Box>
  );
}

import React, { useState, useEffect } from 'react';
import { execFile } from 'child_process';
import { Box, Text } from 'react-drm';
import { BackButton } from '../components/BackButton';

interface Service {
  name:  string;
  state: 'active' | 'inactive' | 'failed' | 'unknown';
}

function parseServices(out: string): Service[] {
  return out
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, 16)
    .map(line => {
      const p    = line.split(/\s+/);
      const name = (p[0] ?? '').replace(/\.service$/, '');
      const sub  = p[3] ?? '';
      const state: Service['state'] =
        sub === 'running' ? 'active'  :
        sub === 'failed'  ? 'failed'  :
        sub === 'dead'    ? 'inactive': 'unknown';
      return { name, state };
    });
}

function fetchServices(cb: (list: Service[]) => void) {
  execFile('systemctl', ['list-units', '--type=service', '--no-pager', '--no-legend', '--plain', '--all'],
    (e, o) => { if (!e) cb(parseServices(o)); });
}

const DOT_COLOR = { active: '#22c55e', inactive: '#334155', failed: '#ef4444', unknown: '#334155' } as const;
const TEXT_COLOR = { active: '#64748b', inactive: '#334155', failed: '#fca5a5', unknown: '#334155' } as const;
const BG_COLOR   = { active: '#0b1120', inactive: '#0b1120', failed: '#1a0a0a', unknown: '#0b1120' } as const;
const BD_COLOR   = { active: '#1e293b', inactive: '#1a2233', failed: '#5c1010', unknown: '#1a2233' } as const;

export function BackgroundServices({ width, height }: { width: number; height: number }) {
  const [services, setServices] = useState<Service[]>([]);

  useEffect(() => {
    fetchServices(setServices);
    const id = setInterval(() => fetchServices(setServices), 5000);
    return () => clearInterval(id);
  }, []);

  const active   = services.filter(s => s.state === 'active').length;
  const failed   = services.filter(s => s.state === 'failed').length;
  const inactive = services.filter(s => s.state === 'inactive').length;

  return (
    <Box style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 }}>

      <BackButton />

      {/* Header label */}
      <Text color="#334155" fontSize={10} fontFamily="monospace" style={{ fontWeight: '700' }}>SVCS</Text>

      {/* Stats */}
      <Box style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: '#0b1120', borderColor: '#1e293b', borderWidth: 1, borderRadius: 6,
        paddingHorizontal: 10, paddingVertical: 3,
      }}>
        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#22c55e',
            shadowColor: '#22c55e', shadowRadius: 3, shadowOpacity: 0.6 }} />
          <Text color="#22c55e" fontSize={12} fontFamily="monospace" style={{ fontWeight: '600' }}>{active}</Text>
        </Box>

        <Box style={{ width: 1, backgroundColor: '#1e293b', alignSelf: 'stretch' }} />

        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#ef4444',
            shadowColor: '#ef4444', shadowRadius: failed > 0 ? 4 : 0, shadowOpacity: failed > 0 ? 0.8 : 0 }} />
          <Text color={failed > 0 ? '#ef4444' : '#334155'} fontSize={12} fontFamily="monospace" style={{ fontWeight: '600' }}>{failed}</Text>
        </Box>

        <Box style={{ width: 1, backgroundColor: '#1e293b', alignSelf: 'stretch' }} />

        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Box style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#334155' }} />
          <Text color="#334155" fontSize={12} fontFamily="monospace">{inactive}</Text>
        </Box>
      </Box>

      {/* Divider */}
      <Box style={{ width: 1, backgroundColor: '#1e293b', alignSelf: 'stretch', marginVertical: 6 }} />

      {/* Service chips */}
      <Box style={{ flex: 1, flexDirection: 'row', gap: 5, overflow: 'hidden' }}>
        {services.map(svc => (
          <Box
            key={svc.name}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: BG_COLOR[svc.state],
              borderColor: BD_COLOR[svc.state], borderWidth: 1, borderRadius: 5,
              paddingHorizontal: 7, paddingVertical: 2,
              shadowColor:   svc.state === 'failed' ? '#ef4444' : 'transparent',
              shadowRadius:  svc.state === 'failed' ? 4 : 0,
              shadowOpacity: svc.state === 'failed' ? 0.4 : 0,
            }}
          >
            <Box style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: DOT_COLOR[svc.state] }} />
            <Text color={TEXT_COLOR[svc.state]} fontSize={11} fontFamily="monospace">{svc.name}</Text>
          </Box>
        ))}
      </Box>

    </Box>
  );
}

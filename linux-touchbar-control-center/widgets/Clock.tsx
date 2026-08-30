import React, { useEffect, useState } from 'react';
import { Text } from 'react-drm';

/**
 * Custom Layer's Clock widget — the one placeholder given real content
 * (live time) instead of just its type name; see widgets/README or
 * app/custom-layer/page.tsx's DraggableWidget for how a widget's `type`
 * picks this over the plain label the other placeholder types still use.
 */
export function Clock() {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Text style={{ color: '#e5e7eb', fontSize: 15 }}>
      {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </Text>
  );
}

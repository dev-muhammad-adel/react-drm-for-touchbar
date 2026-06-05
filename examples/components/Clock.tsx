import React, { useState, useEffect } from 'react';
import { Text } from 'react-drm';

export function Clock({ x }: { x: number }) {
  const [time, setTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <Text x={x} y={12} color="#facc15" fontSize={34} fontFamily="monospace">
      {time}
    </Text>
  );
}

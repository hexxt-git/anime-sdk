import { motion, AnimatePresence } from 'motion/react';
import { useEffect, useState } from 'react';

interface NotificationData {
  id: string;
  text: string;
  delay: number;
}

const NOTIFICATIONS: NotificationData[] = [
  { id: 'manga', text: 'Now supports Manga', delay: 0.2 },
  { id: 'downloads', text: 'Now supports Downloads', delay: 0.8 },
];

export default function Notification() {
  const [visibleNotifications, setVisibleNotifications] = useState<NotificationData[]>([]);

  useEffect(() => {
    const timers = NOTIFICATIONS.map((notif) => {
      return setTimeout(() => {
        setVisibleNotifications((prev) => {
          if (prev.some((n) => n.id === notif.id)) return prev;
          return [...prev, notif];
        });
      }, notif.delay * 1000);
    });

    return () => {
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const handleDismiss = (id: string) => {
    setVisibleNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        width: '240px',
        pointerEvents: 'auto',
        gap: '1px',
      }}
    >
      <AnimatePresence>
        {visibleNotifications.map((notif) => (
          <NotificationCard
            key={notif.id}
            notification={notif}
            onDismiss={() => handleDismiss(notif.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface NotificationCardProps {
  notification: NotificationData;
  onDismiss: () => void;
}

function NotificationCard({ notification, onDismiss }: NotificationCardProps) {
  return (
    <motion.div
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{
        type: 'spring',
        stiffness: 140,
        damping: 18,
      }}
      onClick={onDismiss}
      style={{
        position: 'relative',
        background: '#f57722', // Standard full brightness orange hex value
        color: '#000000', // solid black text
        padding: '10px 14px',
        fontSize: '13.5px',
        fontWeight: 700,
        boxSizing: 'border-box',
        cursor: 'pointer',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {/* Visual Timer Background */}
      <motion.div
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{
          duration: 5,
          ease: 'linear',
        }}
        onAnimationComplete={onDismiss}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          background: '#fa6602', // Standard darker orange hex value (softer contrast)
          zIndex: 0,
        }}
      />

      {/* Content */}
      <span style={{ position: 'relative', zIndex: 1, pointerEvents: 'none' }}>
        {notification.text}
      </span>
    </motion.div>
  );
}

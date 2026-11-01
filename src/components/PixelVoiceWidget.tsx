/**
 * Pixel Voice Widget
 * The long floating banner above Pixel has been removed per UX redesign requirements.
 * Persistent voice coordinator runs cleanly in the background.
 */

import React from 'react';

interface PixelVoiceWidgetProps {
  onOpenPixelChat?: () => void;
  onOpenFullscreenModal?: () => void;
  onOpenSettings?: () => void;
  onOpenDiagnostics?: () => void;
}

export const PixelVoiceWidget: React.FC<PixelVoiceWidgetProps> = () => {
  return null;
};


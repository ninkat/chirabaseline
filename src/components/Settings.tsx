import React from 'react';
import { useY } from 'react-yjs';
import { YjsContext } from '../context/YjsContext';

export const Settings: React.FC = () => {
  const doc = React.useContext(YjsContext);
  const ySettings = doc.getMap<boolean>('settings');
  const settings = useY(ySettings);

  // initialize default settings if they don't exist
  React.useEffect(() => {
    if (!ySettings.has('weeklyReminderEmail')) {
      ySettings.set('weeklyReminderEmail', true);
    }
  }, []);

  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={settings.weeklyReminderEmail}
          onChange={(event) => {
            ySettings.set('weeklyReminderEmail', event.currentTarget.checked);
          }}
        />
        Weekly Reminder Email
      </label>
      <div>Result: {JSON.stringify(settings, null, 2)}</div>
    </>
  );
};

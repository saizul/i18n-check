import { defineMessages, FormattedMessage, useIntl } from 'react-intl';

const messages = defineMessages({
  title: { id: 'app.title', defaultMessage: 'Dashboard' },
  greeting: {
    id: 'app.greeting',
    defaultMessage: 'Hi {name}, you have {count, plural, one {# task} other {# tasks}}',
  },
});

export function App({ name, count, section }) {
  const intl = useIntl();
  return (
    <div>
      <h1>{intl.formatMessage(messages.title)}</h1>
      <p>{intl.formatMessage(messages.greeting, { name, count })}</p>
      <FormattedMessage id="app.logout" defaultMessage="Log out" />
      <FormattedMessage id={`section.${section}`} />
      <span>{intl.formatMessage({ id: 'app.notDefined' })}</span>
    </div>
  );
}

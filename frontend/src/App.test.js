import { render, screen } from '@testing-library/react';
import App from './App';

// react-markdown is ESM-only, which CRA's jest config doesn't transform.
jest.mock('react-markdown', () => ({ children }) => children);

beforeEach(() => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
  if (!global.crypto) global.crypto = {};
  if (!global.crypto.randomUUID) global.crypto.randomUUID = () => 'test-session';
  Element.prototype.scrollIntoView = jest.fn();
});

test('renders BenchIQ without crashing', () => {
  render(<App />);
  expect(screen.getByText('BenchIQ')).toBeInTheDocument();
});

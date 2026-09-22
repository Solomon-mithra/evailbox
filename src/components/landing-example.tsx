'use client';

import { useState } from 'react';
import { ArrowDown, BriefcaseBusiness, Check, House, SlidersHorizontal, Tag } from 'lucide-react';
import styles from './landing-example.module.css';

const examples = {
  personal: {
    label: 'Personal',
    tag: 'Life admin',
    rule: 'Find bills due soon, appointment changes, and documents I need to send.',
    messages: [
      {
        from: 'Greenway Energy',
        initials: 'GE',
        subject: 'Your payment is due on Friday',
        source: 'Gmail',
        time: '9:41',
      },
      {
        from: 'Parkside Dental',
        initials: 'PD',
        subject: 'A change to your appointment',
        source: 'Outlook',
        time: '9:12',
      },
    ],
  },
  work: {
    label: 'Work',
    tag: 'Client requests',
    rule: 'Find client emails asking for a decision, feedback, or a change to the project.',
    messages: [
      {
        from: 'Sam at Northstar',
        initials: 'SN',
        subject: 'Can you approve the updated scope?',
        source: 'Outlook',
        time: '10:24',
      },
      {
        from: 'Maya at Studio',
        initials: 'MS',
        subject: 'Your thoughts before we go ahead?',
        source: 'Gmail',
        time: '9:58',
      },
    ],
  },
};

export function LandingExample() {
  const [selected, setSelected] = useState<'personal' | 'work'>('personal');
  const example = examples[selected];
  return (
    <div className={styles.example}>
      <div className={styles.topline}>
        <span className={styles.exampleLabel}>
          <span aria-hidden="true" /> See the idea in action
        </span>
        <span className={styles.sampleLabel}>Illustrative example</span>
      </div>
      <div className={styles.switcher} role="group" aria-label="Choose an example workspace">
        <button
          type="button"
          aria-pressed={selected === 'personal'}
          onClick={() => setSelected('personal')}
          aria-controls="example-results"
        >
          <House size={15} aria-hidden="true" /> Personal
        </button>
        <button
          type="button"
          aria-pressed={selected === 'work'}
          onClick={() => setSelected('work')}
          aria-controls="example-results"
        >
          <BriefcaseBusiness size={15} aria-hidden="true" /> Work
        </button>
      </div>
      <div id="example-results" className={styles.results} aria-live="polite" aria-atomic="true">
        <div className={styles.rule}>
          <div className={styles.ruleLabel}>
            <span>
              <SlidersHorizontal size={14} aria-hidden="true" /> Your rule
            </span>
            <span className={styles.priority}>High priority</span>
          </div>
          <p>“{example.rule}”</p>
          <span className={styles.tag}>
            <Tag size={12} aria-hidden="true" /> {example.tag}
          </span>
        </div>
        <div className={styles.connection}>
          <ArrowDown size={16} aria-hidden="true" /> evailbox finds what fits
        </div>
        <div className={styles.matches}>
          <div className={styles.matchesHeading}>
            <span>
              <Check size={15} aria-hidden="true" /> In focus
            </span>
            <span>2 example matches</span>
          </div>
          <ul>
            {example.messages.map((message) => (
              <li key={message.from}>
                <span className={styles.avatar} aria-hidden="true">
                  {message.initials}
                </span>
                <div className={styles.messageBody}>
                  <div className={styles.messageMeta}>
                    <span>{message.from}</span>
                    <span>{message.time}</span>
                  </div>
                  <p>{message.subject}</p>
                  <div className={styles.messageBottom}>
                    <span className={styles.matchTag}>{example.tag}</span>
                    <span>{message.source}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className={styles.note}>Your words become a more useful inbox.</p>
    </div>
  );
}

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SponsorLevel } from '@/server/repositories/sponsors.repository';
import type { AdminSponsor, AdminSponsorGroup } from '@/server/services/sponsors.service';
import { formContext } from '@/app/admin/(protected)/sponsors/form-context';
import { SponsorPreview } from '@/app/admin/(protected)/sponsors/sponsor-preview';
import { SPONSOR_LOGO_BOXES, fitLogo } from '@/lib/sponsor-fit';

/**
 * B15 form helpers: the preview draws the logo with the public tiles' own
 * sizing rule, and the form knows who is presenting now and where the end
 * of each level is.
 */

const T0 = new Date('2026-09-25T10:00:00Z');

function sponsor(id: string, level: SponsorLevel, over: Partial<AdminSponsor> = {}): AdminSponsor {
  return {
    id,
    name: `Sponsor ${id}`,
    websiteUrl: null,
    level,
    logoKey: `sponsors/${id}/logo.svg`,
    logoWidth: 300,
    logoHeight: 100,
    tileTone: 'light',
    active: true,
    position: 1,
    createdAt: T0,
    updatedAt: T0,
    logoUrl: `https://cdn.example/${id}.svg`,
    ...over,
  };
}

function groups(...sponsors: AdminSponsor[]): AdminSponsorGroup[] {
  return (['presenting', 'partner', 'supporter'] as const).map((level) => ({
    level,
    sponsors: sponsors.filter((s) => s.level === level),
  }));
}

describe('formContext', () => {
  it('names the presenting partner even when it is hidden', () => {
    const list = groups(sponsor('p', 'presenting', { name: 'Kolorob Audio', active: false }));
    expect(formContext(list, null).presenting).toEqual({ id: 'p', name: 'Kolorob Audio' });
    expect(formContext(groups(), null).presenting).toBeNull();
  });

  it('counts each level without the sponsor being edited', () => {
    const list = groups(
      sponsor('p', 'presenting'),
      sponsor('a', 'partner'),
      sponsor('b', 'partner'),
      sponsor('c', 'supporter'),
    );
    expect(formContext(list, null).levelCounts).toEqual({
      presenting: 1,
      partner: 2,
      supporter: 1,
    });
    expect(formContext(list, 'b').levelCounts).toEqual({
      presenting: 1,
      partner: 1,
      supporter: 1,
    });
  });
});

describe('SponsorPreview', () => {
  const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
  const logo = { src: 'blob:logo', width: 700, height: 100 };

  it('draws the logo at the admin preview, level and footer sizes', () => {
    const out = html(createElement(SponsorPreview, { logo, level: 'supporter', tone: 'dark' }));
    const size = (box: Parameters<typeof fitLogo>[1]) => fitLogo(7, box);
    const preview = size(SPONSOR_LOGO_BOXES.adminPreview);
    const live = size(SPONSOR_LOGO_BOXES.supporter.desktop);
    const footer = size(SPONSOR_LOGO_BOXES.footer);
    expect(out.match(/<img /g)).toHaveLength(4);
    expect(out).toContain(`width:${preview.w}px;height:${preview.h}px`);
    expect(out).toContain(`width:${live.w}px;height:${live.h}px`);
    expect(out).toContain(`width:${footer.w}px;height:${footer.h}px`);
    // The level's tile height, and the words for what is shown.
    expect(out).toContain(`height:${SPONSOR_LOGO_BOXES.supporter.desktop.h}px`);
    expect(out).toContain('as it will appear · Supporter · dark tile');
  });

  it('shows empty tiles until there is a logo', () => {
    const out = html(
      createElement(SponsorPreview, { logo: null, level: 'presenting', tone: 'light' }),
    );
    expect(out).not.toContain('<img');
    expect(out).toContain('as it will appear · Presenting partner · light tile');
    expect(out).toContain(`height:${SPONSOR_LOGO_BOXES.presenting.desktop.h}px`);
  });
});

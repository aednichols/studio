// =============================================================================
// Dashboard Scripts
// (c) Mathigon
// =============================================================================


import './main';



import {cache, Obj} from '@mathigon/core';
import {$, $$, $body, Browser} from '@mathigon/boost';
import {Modal} from '@mathigon/studio';


// -----------------------------------------------------------------------------
// Interfaces

interface Section {
  id: string;
  title: string;
  locked: boolean;
  progress: number;
}

interface Course {
  id: string;
  title: string;
  color: string;
  progress: number;
  sections: Section[];
}

interface Student {
  id: string;
  name: string;
  avatar: string;
  minutes: number;
  canDelete: boolean;
  courses: string[];
  progress: Obj<number>;
}

declare global {
  interface Window {
    rosterData?: Student[];
  }
}


// -----------------------------------------------------------------------------
// Dashboard Code

const validate = cache((query: string) =>
  fetch(`/validate?${query}`).then((response) => response.text()));

Browser.ready(() => {
  for (const $a of $$('.alert')) {
    $a.$('.close')!.on('click', () => $a.remove());
  }

  // ---------------------------------------------------------------------------

  const $addCode = $('#add-class-code');
  if ($addCode) {
    new Vue({
      el: $addCode.$('form')!._el,
      data: {classCode: '', invalid: ''},
      watch: {
        async classCode(code: string) {
          let c = code.toUpperCase().replace(/[^A-Z0-9]/g, '').substr(0, 8);
          if (c.length > 4) c = c.substr(0, 4) + '-' + c.substr(4, 4);
          this.classCode = c;

          if (c.length !== 9) return this.invalid = 'invalid';
          this.invalid = await validate(`classcode=${c}`);
        }
      }
    });
  }

  // ---------------------------------------------------------------------------

  const $roster = $('#roster');
  if ($roster) {
    const students = JSON.parse($('#student-data')!.text) as Student[];
    const courses = JSON.parse($('#course-data')!.text) as Course[];

    const courseMap: Obj<Course> = {};
    for (const c of courses) courseMap[c.id] = c;

    const $removeModal = $('#remove-student') as Modal;
    const $removeForm = $removeModal.$('form')!;
    const removeUrl = $removeForm.attr('action');

    const vue = new Vue({
      el: $roster._el,
      data: {
        students, courses, panel: '', courseMap, course: courses[0],
        section: courses[0].sections[0], expanded: ''
      },
      watch: {
        course() {
          this.section = this.course.sections.find((s: any) => !s.locked)!;
        }
      },
      methods: {
        removeStudent(event: Event, student: Student) {
          event.stopPropagation();
          $removeForm.setAttr('action', removeUrl.replace('xxx', student.id));
          for (const $s of $removeModal.$$('strong')) $s.text = student.name;
          $removeModal.open();
        }
      }
    });

    const $popups = $$('#roster .popup, .title.interactive');
    $body.on('pointerdown', (e: Event) => {
      const $el = $(e.target as Element)!;
      if (!$popups.some($p => $p.equals($el)) && !$el.hasParent(...$popups)) {
        vue.panel = '';
      }
    });
  }
});

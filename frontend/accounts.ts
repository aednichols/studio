// =============================================================================
// Accounts Scripts
// (c) Mathigon
// =============================================================================


import {$, CustomElementView, FormView, InputView, observe, register, Router} from '@mathigon/boost';
import './main';


// -----------------------------------------------------------------------------
// Password Component

const combinations = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '01234567890'];
for (let i = 0; i < 2; ++i) combinations.push(combinations[i].toUpperCase());
for (let i = 0; i < 5; ++i) {
  combinations.push(combinations[i].split('').reverse().join(''));
}

function passwordStrength(q = '') {
  if (q.length < 5) return 'Too Short';

  let p = q.replace(/(.)\1*/, function(x, y) {
    return y;
  });  // repetitions
  p = p.replace(/password/gi, 'p').replace(/mathigon/gi, 'm');

  for (const s of combinations) {
    for (let i = 0; i < s.length - 1; ++i) {
      for (let j = Math.min(p.length, s.length - i); j > 2; --j) {
        const sub = s.substr(i, j);
        p = p.replace(sub, sub[0] + sub[1]);
      }
    }
  }

  let space = 0;
  if (q.match(/[0-9]/)) space += 10;
  if (q.match(/[a-z]/)) space += 26;
  if (q.match(/[A-Z]/)) space += 26;
  if (q.match(/[^0-9a-zA-Z]/)) space += 10;

  const score = p.length * Math.log(space);

  if (score < 30) return 'Weak';
  if (score < 50) return 'OK';
  return 'Strong';
}

const template = `<input name="password" :type="reveal?'text':'password'" required placeholder="Password" pattern=".{4,}" autocomplete="new-password" :class="value.length < 5 ? 'invalid' : ''"/>
<span class="placeholder">Password <span class="strength" :class="strength" :if="strength">(\${strength})</span></span>
<div class="toggle" :class="reveal?'on':''"><x-icon name="eye"></x-icon></div>`;

@register('x-password', {template})
export class Password extends CustomElementView {
  ready() {
    this.bindModel(observe({strength: '', reveal: false}));
    this.$('.toggle')!.on('click', () => this.model.reveal = !this.model.reveal);
    this.$('input')!.change((value) => {
      this.model.strength = value ? passwordStrength(value) : '';
      this.$('input')!.setValidity(value.length < 5 ? 'Please pick a longer password.' : '');
    });
  }
}


// -----------------------------------------------------------------------------
// Routes

Router.setup({
  $viewport: $('main')!,
  preloaded: true,
  click: true,
  history: true,
  initialise: ($el) => {
    for (const $form of $el.$$('form') as FormView[]) {
      $form.on('submit', (e: Event) => {
        if (!$form.isValid) {
          e.preventDefault();
          return false;
        }
      });
    }

    for (const $i of $el.$$('.form-field input')) {
      $i.on('blur invalid valid', () => $i.addClass('dirty'));
    }
    for (const $a of $el.$$('.alert')) {
      $a.$('.close')!.on('click', () => $a.remove());
    }
  }
});

Router.view('/signup', {
  enter($el) {
    const $bday = $el.$('input[name="birthday"]') as InputView;
    $bday.change((date) => {
      const age = (Date.now() - (+new Date(date))) / (1000 * 60 * 60 * 24 * 365);
      if (age < 0 || age > 100) return $bday.setValidity('Please enter a valid date of birth.');
      if (age < 13) return $bday.setValidity('You have to be at least 13 years old to create an account.');
      $bday.setValidity('');
    });
  }
});

Router.paths('/login', '/forgot', '/reset', '/reset/:token', '/profile');






import {cache} from '@mathigon/core';
import {Browser, ElementView, Modal} from '@mathigon/boost';

const maxAge = 1000 * 60 * 60 * 24 * 365 * 110;  // 110 years

const validate = cache((query: string) =>
  fetch(`/validate?${query}`).then((response) => response.text()));

function signup($el: ElementView) {
  const $login = $('#login') as Modal;
  const hash = Browser.getHash();

  new Vue({
    el: $el.$('.signup-box')!._el,
    data: {
      // Prefill input field on iOS, to fix select dropdown styling.
      birthday: Browser.isIOS ? '2000-01-01' : '',
      email: '',
      username: '',
      classCode: '',
      newsletter: false,
      type: ['student', 'teacher', 'parent'].includes(hash) ? hash : 'student',
      step: 1,
      useClassCode: false,
      isRestricted: false,
      errors: {birthday: '', email: '', username: '', classCode: ''}
    },
    watch: {
      birthday(birthday: string) {
        const d = Date.now() - (+new Date(birthday));
        this.errors.birthday = d < 0 || d > maxAge ? 'invalid' : '';
        this.isRestricted = d < 1000 * 60 * 60 * 24 * 365 * 13;  // 13 years
      },
      type() {
        this.step = 1;
        this.useClassCode = false;
        this.newsletter = (this.type !== 'student');
      },
      async email(email: string) {
        this.errors.email = await validate(`email=${email}`);
      },
      async username(str: string) {
        this.username = str.toLowerCase().replace(/[^a-z0-9]/g, '');

        if (this.username.length < 4) {
          this.errors.username = 'short';
        } else {
          this.errors.username = await validate(`username=${this.username}`);
        }
      }
    },
    computed: {
      studentCanProceed() {
        const birthdayValid = this.birthday && !this.errors.birthday;
        const classCodeValid = this.classCode && !this.errors.classCode;
        return birthdayValid && (!this.useClassCode || classCodeValid);
      }
    },
    methods: {
      login() {
        $login.open();
      },
      async checkClassCode(code: string) {
        let c = code.toUpperCase().replace(/[^A-Z0-9]/g, '').substr(0, 8);
        if (c.length > 4) c = c.substr(0, 4) + '-' + c.substr(4, 4);
        this.classCode = c;

        if (c.length !== 9) return this.errors.classCode = 'invalid';
        this.errors.classCode = await validate(`classcode=${c}`);
      }
    }
  });
}

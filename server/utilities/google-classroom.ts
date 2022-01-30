// =============================================================================
// Google Classroom Integration
// (c) Mathigon
// =============================================================================


import fetch from 'node-fetch';
import {sortBy} from '@mathigon/core';
import {User} from '../models/user';
import {Classroom} from '../models/classroom';
import {redirect} from '../../server/utilities';
import {sendStudentAddedToClassEmail} from './emails';
import {oAuthLogin, oAuthToken} from './oauth';
import {normalizeEmail} from './validate';


const SCOPES = ['https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.rosters.readonly',
  'https://www.googleapis.com/auth/classroom.profile.emails',
  'https://www.googleapis.com/auth/classroom.profile.photos'].join(' ');

const GET_COURSES = 'https://classroom.googleapis.com/v1/courses';
const CALLBACK = '/auth/classroom/callback';


async function makeRequest(url, token) {
  if (!token) return undefined;
  const headers = {Authorization: 'Bearer ' + token};
  const response = await fetch(GET_COURSES + url, {method: 'GET', headers});
  if (!response.ok) return undefined;
  return (await response.json()) || {};
}

async function getClassroomAuth(req, res, next) {
  if (!req.user || req.user.type !== 'teacher') return res.redirect('/');

  const classroom = await findClass(req.params.code);
  if (!classroom) return next();
  req.session.classCodeForGoogle = classroom.code;

  const redirection = oAuthLogin('google', req, SCOPES, CALLBACK);
  if (!redirection) return next();
  res.redirect(redirection);
}

async function getClassroomCallback(req, res, next) {
  if (!req.user || req.user.type !== 'teacher') return res.redirect('/');

  const token = await oAuthToken('google', req, CALLBACK);
  const data = await makeRequest('', token);

  const classroom = await findClass(req.session.classCodeForGoogle);

  const error = !data || !data.courses || !data.courses.length || !classroom;
  if (error) {
    const error = data ? 'classroomNoCourses' : 'classroomError';
    const url = classroom ? `/dashboard/${classroom.code}` : '/dashboard';
    return redirect(req, res, {error}, url);
  }

  req.session.googleClassroomToken = token;
  req.session.googleClassroomCourses = sortBy(data.courses
      .filter(c => c.courseState === 'ACTIVE')
      .map(c => ({id: c.id, name: c.name})), c => c.name);

  return redirect(req, res, {}, `/dashboard/${classroom.code}`);
}

async function getClassroomCourse(req, res) {
  if (!req.user || req.user.type !== 'teacher') return res.redirect('/');

  const classroom = await findClass(req.session.classCodeForGoogle);
  const url = classroom ? `/dashboard/${classroom.code}` : '/dashboard';
  const token = req.session.googleClassroomToken;

  if (!req.params.id || !token || !classroom) {
    return redirect(req, res, {error: 'classroomError'}, url);
  }

  const data = await makeRequest(`/${req.params.id}/students?pageSize=100`, token);
  if (!data) return redirect(req, res, {error: 'classroomError'}, url);

  const students = data.students || [];
  let newUsers = 0;

  for (const s of students) {
    if (!s.profile.emailAddress) continue;
    const email = normalizeEmail(s.profile.emailAddress);
    let user = await User.findOne({email: email});

    // If there already is an account with the same email address, but the
    // email address has not been verified, we have to remove it.
    if (user && user.emailVerificationToken) {
      user.email += '__removed';
      await user.save();
      user = undefined;
    }

    // Can't add non-student accounts to teacher dashboards.
    if (user && user.type !== 'student') continue;

    // Skip students that are already part of this class.
    if (user && user.classesJoined.includes(classroom.code)) continue;

    const isNew = !user;
    if (!user) user = new User({email, type: 'student'});

    if (!user.first) user.first = s.profile.name.givenName;
    if (!user.last) user.last = s.profile.name.familyName;
    if (!user.picture) user.picture = s.profile.photoUrl;
    if (!user.country) user.country = req.user.country;
    if (!user.google) user.google = s.userId;
    user.addClassCode(classroom.code);
    user.acceptedPolicies = true;
    await user.save();

    if (isNew) sendStudentAddedToClassEmail(user, req.user);  // async
    newUsers += 1;
  }

  const success = newUsers ? 'classroomImport' : 'classroomNoStudents';
  return redirect(req, res, {success, params: [newUsers]}, url);
}

// =============================================================================
// Dashboard Server
// (c) Mathigon
// =============================================================================


import {MathigonStudioApp} from './app';
import {findClass, createClass, recentCourseIds} from './models/classroom';
import {getClassroomAuth, getClassroomCallback, getClassroomCourse} from './utilities/google-classroom';


// -----------------------------------------------------------------------------
// Dashboard Views

async function getStudentDashboard(req, res) {
  const progressData = await req.user.getCourseProgress();
  const teachers = await req.user.getTeachers();
  const stats = await req.user.getWeeklyStats();

  const recent = recentCourseIds(progressData, true).slice(0, 6);
  const items = Math.min(4, 6 - recent.length);
  const recommended = RECOMMENDATIONS.filter(x => !progressData[x]).slice(0, items);

  res.render('dashboard/student', {
    progressData, recent, recommended, teachers, stats
  });
}

async function getClassList(req, res) {
  if (!req.user) return res.redirect('/login');
  if (req.user.type !== 'teacher') return res.redirect('/dashboard');

  const classes = await Promise.all(req.user.classesManaged.map(code => findClass(code)));
  const students = await Promise.all(classes.map(c => c.getStudents()));
  res.render('dashboard/teacher', {classes, students});
}

async function getClassDashboard(req, res, next) {
  if (!req.user) return res.redirect('/login');

  const classroom = await findClass(req.params.code);
  if (!classroom || !classroom.isTeacher(req.user)) return next();

  const branding = req.query.branding || undefined;
  const {studentData, courseData} = await classroom.getDashboardData(branding);
  const googleClassroomCourses = req.session.googleClassroomCourses;
  req.session.googleClassroomCourses = undefined;

  res.render('dashboard/class', {studentData, courseData, classroom, googleClassroomCourses});
}

async function getParentDashboard(req, res) {
  const classroom = await findClass(req.user.classesManaged[0]);
  const students = classroom ? await classroom.getStudents() : [];

  const studentData = await Promise.all(students.map(async (student) => {
    const progress = await student.getCourseProgress();
    return {data: student, progress, courses: recentCourseIds(progress)};
  }));

  res.render('dashboard/parent', {studentData});
}


// -----------------------------------------------------------------------------
// POST Requests

async function postJoinClass(req, res) {
  if (!req.user) return res.redirect('/login');
  const response = await req.user.joinClass(req.body.code);
  return redirect(req, res, response, '/dashboard');
}

async function postRemoveStudent(req, res, next) {
  if (!req.user) return res.redirect('/login');

  const classroom = await findClass(req.params.code);
  if (!classroom || !classroom.isTeacher(req.user)) return next();

  const response = await classroom.removeStudent(req.params.user);
  return redirect(req, res, response, `/dashboard/${req.params.code}`);
}

async function postNewClass(req, res) {
  if (!req.user) return res.redirect('/login');
  if (req.user.type !== 'teacher') return res.redirect('/dashboard');

  if (req.user.classesManaged.length >= 20) {
    return redirect(req, res, {error: 'tooManyClasses'}, '/dashboard');
  }

  const classroom = await createClass(req.body.title, req.user);
  await req.user.save();
  return res.redirect(`/dashboard/${classroom.code}`);
}

async function postEditClass(req, res, next) {
  if (!req.user) return res.redirect('/login');

  const classroom = await findClass(req.params.code);
  if (!classroom || !classroom.isTeacher(req.user)) return next();

  if (req.body.title) classroom.title = req.body.title;
  await classroom.save();
  return res.redirect(`/dashboard/${classroom.code}`);
}

async function postDeleteClass(req, res, next) {
  if (!req.user) return res.redirect('/login');

  const classroom = await findClass(req.params.code);
  if (!classroom || !classroom.isTeacher(req.user)) return next();

  const response = await classroom.delete(req.user);
  return redirect(req, res, response, '/dashboard');
}


// -----------------------------------------------------------------------------
// Exports

schema.methods.isTeacher = function(user) {
  if (!user || !user.classesManaged) return false;
  return user.classesManaged.includes(this.code);
};

schema.methods.removeStudent = async function(studentId) {
  if (!isMongoID(studentId)) return {error: 'unknown'};

  const student = await require('./user').findById(studentId);
  if (!student || !student.canRemoveClassCode()) return {error: 'removeClassCodeError'};

  await student.removeClassCode(this.code);
  return {success: 'removeClassCode', params: [student.name()]};
};

schema.methods.canRemoveClassCode = function() {
  return this.isRestricted || this.classesJoined.length > 1 ||
         !this.birthday || this.canUpgrade();
};

schema.methods.joinClass = async function(code) {
  if (this.type !== 'student') return {error: 'joinClassError'};
  if (this.classesJoined.includes(code)) return {error: 'alreadyJoinClassError'};

  const classroom = await findClass(code);
  if (!classroom) return {error: 'invalidClassCode'};
  const teacher = await classroom.getTeacher();

  // If a restricted student account has not been verified, we do that now.
  if (this.isRestricted && !this.guardianConsent) {
    this.guardianEmail = teacher.email;
    this.guardianConsent = true;
  }

  this.classesJoined.push(code);
  await this.save();
  await sendClassCodeAddedEmail(this, classroom);

  return {success: 'joinClass', params: [teacher.name()]};
};

function getDashboard(req, res) {
  if (!req.user) return res.redirect('/login');
  if (req.user.type === 'teacher') return getClassList(req, res);
  if (req.user.type === 'parent') return getParentDashboard(req, res);
  return getStudentDashboard(req, res);
}


export default function setupDashboardEndpoints(app: MathigonStudioApp) {
  app.get('/dashboard', getDashboard);
  app.get('/dashboard/:code', getClassDashboard);
  app.post('/dashboard/add', postJoinClass);
  app.post('/dashboard/new', postNewClass);
  app.post('/dashboard/:code/remove/:user', postRemoveStudent);
  app.post('/dashboard/:code', postEditClass);
  app.post('/dashboard/:code/delete', postDeleteClass);

  app.get('/auth/classroom/:code', getClassroomAuth);
  app.get('/auth/classroom/callback', getClassroomCallback);
  app.get('/auth/classroom/course/:id', getClassroomCourse);
}

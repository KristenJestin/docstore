using Docstore.App.Models.Forms;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;

namespace Docstore.App.Controllers
{
    [AllowAnonymous]
    public class AuthController : Controller
    {
        // Pick from https://docs.microsoft.com/en-US/aspnet/core/security/authentication/identity?view=aspnetcore-6.0&tabs=visual-studio#scaffold-register-login-logout-and-registerconfirmation

        private readonly ILogger<AuthController> _logger;
        private readonly UserManager<IdentityUser> _userManager;
        private readonly SignInManager<IdentityUser> _signInManager;

        public AuthController(ILogger<AuthController> logger, UserManager<IdentityUser> userManager, SignInManager<IdentityUser> signInManager)
        {
            _userManager = userManager;
            _logger = logger;
            _signInManager = signInManager;
        }

        #region actions
        public IActionResult Register()
            => View();

        [HttpPost]
        public async Task<IActionResult> Register(RegisterForm form)
        {
            // model validation
            try
            {
                if (ModelState.IsValid && form != null)
                {
                    var user = new IdentityUser { UserName = form.UserName, Email = form.Email };
                    var result = await _userManager.CreateAsync(user, form.Password);

                    if (result.Succeeded)
                    {
                        _logger.LogInformation("User created a new account with password.");
                        await _signInManager.SignInAsync(user, isPersistent: false);

                        // response
                        return RedirectToAction(nameof(HomeController.Index), "Home");
                    }

                    foreach (var error in result.Errors)
                        ModelState.AddModelError(string.Empty, error.Description);
                }

            }
            catch// (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            // response
            return View(form);
        }

        public IActionResult Login()
            => View();

        [HttpPost]
        public async Task<IActionResult> Login(LoginForm form)
        {
            // model validation
            try
            {
                if (ModelState.IsValid && form != null)
                {
                    var result = await _signInManager.PasswordSignInAsync(form.UserName, form.Password, form.RememberMe, lockoutOnFailure: true);
                    if (result.Succeeded)
                    {
                        _logger.LogInformation("User logged in.");
                        return RedirectToAction(nameof(HomeController.Index), "Home");
                    }

                    if (result.IsLockedOut)
                    {
                        _logger.LogWarning("User account locked out.");
                        return RedirectToAction(nameof(LockedOut));
                    }

                    ModelState.AddModelError(string.Empty, "Invalid login attempt.");
                }

            }
            catch// (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            // response
            return View(form);
        }

        public IActionResult LockedOut()
            => View();

        public async Task<IActionResult> Logout()
        {
            await _signInManager.SignOutAsync();
            _logger.LogInformation("User logged out.");

            return RedirectToAction(nameof(Login));
        }


        public IActionResult AccessDenied()
            => View();
        #endregion
    }
}

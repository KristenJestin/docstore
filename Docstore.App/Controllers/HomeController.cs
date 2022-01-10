using Docstore.App.Common;
using Docstore.App.Models;
using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;

namespace Docstore.App.Controllers
{
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> _logger;

        public HomeController(ILogger<HomeController> logger)
        {
            _logger = logger;
        }

        public IActionResult Index()
            => RedirectToAction(nameof(DocumentsController.Index), Helpers.ControllerName<DocumentsController>());

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }
}
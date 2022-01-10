using Microsoft.AspNetCore.Mvc;

namespace Docstore.App.Controllers
{
    public class DocumentsController : Controller
    {
        public IActionResult Index()
        {
            return View();
        }
    }
}

using Docstore.App.Common.Extensions;
using Docstore.App.Models;
using Docstore.Application.Interfaces;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Diagnostics;

namespace Docstore.App.Controllers
{
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> _logger;
        private readonly AppDbContext _db;

        public HomeController(ILogger<HomeController> logger, AppDbContext db)
        {
            _logger = logger;
            _db = db;
        }


        #region actions
        public async Task<IActionResult> Index()
        {
            // get data
            var lastDocuments = await _db.Documents
                .OrderByDescending(d => d.UpdatedAt)
                .Include(d => d.Folder)
                .Take(3).ToListAsync();
            var documents = await _db.Documents
                .Where(d => d.FolderId == null)
                .OrderBy(d => d.Name)
                .Take(8)
                .Select(d => d.WithFilesCount(d.Files.Count).WithSize(d.Files.Sum(f => f.Size)))
                .ToListAsync();
            var folders = await _db.Folders
                .OrderBy(d => d.Name)
                .Take(8)
                .ToListAsync();

            // response
            var viewModel = new HomeIndexViewModel
            {
                LastDocuments = lastDocuments,
                Documents = documents,
                Folders = folders
            };
            return View(viewModel);
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
        #endregion
    }
}
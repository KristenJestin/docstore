using Docstore.App.Common.Extendeds;
using Docstore.App.Models;
using Docstore.Application.Interfaces;
using Docstore.Domain.Extensions;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Diagnostics;

namespace Docstore.App.Controllers
{
    [Authorize]
    public class HomeController : ExtendedController
    {
        private const int PAGE_SIZE = 10;

        private readonly ILogger<HomeController> _logger;
        private readonly ApplicationDbContext _db;
        private readonly IDocumentRepository _documentRepository;
        private readonly IGlobalRepository _globalRepository;

        public HomeController(ILogger<HomeController> logger, ApplicationDbContext db, IDocumentRepository documentRepository, IGlobalRepository globalRepository)
        {
            _logger = logger;
            _db = db;
            _documentRepository = documentRepository;
            _globalRepository = globalRepository;
        }


        #region actions
        public async Task<IActionResult> Index(int? page = 1)
        {
            // get data
            // TODO: use a repository
            var lastDocuments = await _documentRepository.GetLastAsync(UserId, 3);
            var elements = await _globalRepository.GetDocumentsWithoutParentAndFolders(UserId, page ?? 1, PAGE_SIZE);

            // response
            var viewModel = new HomeIndexViewModel
            {
                LastDocuments = lastDocuments,
                Elements = elements
            };
            return View(viewModel);
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
            => View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        #endregion
    }
}